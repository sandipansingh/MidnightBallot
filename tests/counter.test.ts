import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { sampleCoinPublicKey } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  Contract,
  ledger,
  type Ballot,
  type Witnesses,
} from '../managed/counter/contract/index.js';

function ballot(choice: boolean, nonceByte: number): Ballot {
  return { choice, nonce: new Uint8Array(32).fill(nonceByte) };
}

function freshContract(privateBallot: Ballot) {
  const witnesses: Witnesses<Ballot> = {
    privateBallot: ({ privateState }) => [privateState, privateState],
  };
  const contract = new Contract<Ballot>(witnesses);
  const initial = contract.initialState(
    createConstructorContext(privateBallot, sampleCoinPublicKey()),
  );
  const context = createCircuitContext(
    dummyContractAddress(),
    initial.currentZswapLocalState,
    initial.currentContractState,
    initial.currentPrivateState,
  );
  return { contract, context };
}

test('the private choice changes the committed circuit output', () => {
  const yes = freshContract(ballot(true, 71));
  const no = freshContract(ballot(false, 71));

  const yesResult = yes.contract.circuits.castBallot(yes.context);
  const noResult = no.contract.circuits.castBallot(no.context);
  const yesCommitment = [...ledger(yesResult.context.currentQueryContext.state).ballotCommitments][0];
  const noCommitment = [...ledger(noResult.context.currentQueryContext.state).ballotCommitments][0];

  assert.notDeepEqual(yesCommitment, noCommitment);
});

test('accepted ballots increment turnout and an exact replay is rejected', () => {
  const firstBallot = ballot(true, 17);
  const secondBallot = ballot(false, 29);
  const { contract, context } = freshContract(firstBallot);
  const first = contract.circuits.castBallot(context);

  assert.equal(ledger(first.context.currentQueryContext.state).ballotCount, 1n);
  assert.throws(
    () => contract.circuits.castBallot(first.context),
    /Ballot already committed/,
  );
  assert.equal(ledger(first.context.currentQueryContext.state).ballotCount, 1n);

  const second = contract.circuits.castBallot({
    ...first.context,
    currentPrivateState: secondBallot,
  });
  const publicState = ledger(second.context.currentQueryContext.state);
  assert.equal(publicState.ballotCount, 2n);
  assert.equal(publicState.ballotCommitments.size(), 2n);
});

test('the public ledger and transcript contain the commitment, not the private ballot', () => {
  const secret = ballot(true, 193);
  const { contract, context } = freshContract(secret);
  const result = contract.circuits.castBallot(context);
  const publicState = ledger(result.context.currentQueryContext.state);
  const commitment = [...publicState.ballotCommitments][0];
  const publicTranscript = JSON.stringify(result.proofData.publicTranscript);

  assert.deepEqual(Object.keys(publicState).sort(), ['ballotCommitments', 'ballotCount']);
  assert.equal(publicState.ballotCount, 1n);
  assert.notDeepEqual(commitment, secret.nonce);
  assert.equal(publicTranscript.includes('"choice"'), false);
  assert.equal(publicTranscript.includes(JSON.stringify(secret.nonce)), false);
});

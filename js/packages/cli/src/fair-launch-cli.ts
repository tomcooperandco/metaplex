#!/usr/bin/env node
import * as fs from 'fs';
import { program } from 'commander';
import * as anchor from '@project-serum/anchor';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Token } from '@solana/spl-token';
import {
  CACHE_PATH,
  FAIR_LAUNCH_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from './helpers/constants';
import {
  loadFairLaunchProgram,
  loadWalletKey,
  getTokenMint,
  getFairLaunch,
  getTreasury,
  getFairLaunchTicket,
  getAtaForMint,
  getFairLaunchTicketSeqLookup,
  getFairLaunchLotteryBitmap,
} from './helpers/accounts';
import { chunks, getMultipleAccounts, sleep } from './helpers/various';
program.version('0.0.1');

if (!fs.existsSync(CACHE_PATH)) {
  fs.mkdirSync(CACHE_PATH);
}

const FAIR_LAUNCH_TICKET_AMOUNT_LOC = 8 + 32 + 32;
const FAIR_LAUNCH_TICKET_STATE_LOC = FAIR_LAUNCH_TICKET_AMOUNT_LOC + 8;
const FAIR_LAUNCH_TICKET_SEQ_LOC = FAIR_LAUNCH_TICKET_STATE_LOC + 1 + 1;
const FAIR_LAUNCH_LOTTERY_SIZE =
  8 + // discriminator
  32 + // fair launch
  1 + // bump
  8; // size of bitmask ones

program
  .command('new_fair_launch')
  .option(
    '-e, --env <string>',
    'Solana cluster env name',
    'devnet', //mainnet-beta, testnet, devnet
  )
  .option(
    '-k, --keypair <path>',
    `Solana wallet location`,
    '--keypair not provided',
  )
  .option('-u, --uuid <string>', 'uuid')
  .option('-f, --fee <string>', 'fee', '2')
  .option('-s, --price-range-start <string>', 'price range start', '1')
  .option('-e, --price-range-end <string>', 'price range end', '2')
  .option(
    '-arbp, --anti-rug-reserve-bp <string>',
    'optional anti-rug treasury reserve basis points (1-10000)',
  )
  .option(
    '-atc, --anti-rug-token-requirement <string>',
    'optional anti-rug token requirement when reserve opens - 100 means 100 tokens remaining out of total supply',
  )
  .option(
    '-sd, --self-destruct-date <string>',
    'optional date when funds from anti-rug setting will be returned - eg "04 Dec 1995 00:12:00 GMT"',
  )
  .option(
    '-pos, --phase-one-start-date <string>',
    'timestamp - eg "04 Dec 1995 00:12:00 GMT"',
  )
  .option(
    '-poe, --phase-one-end-date <string>',
    'timestamp - eg "04 Dec 1995 00:12:00 GMT"',
  )
  .option(
    '-pte, --phase-two-end-date <string>',
    'timestamp - eg "04 Dec 1995 00:12:00 GMT"',
  )
  .option('-ts, --tick-size <string>', 'tick size', '0.1')
  .option('-n, --number-of-tokens <number>', 'Number of tokens to sell')
  .option(
    '-mint, --token-mint <string>',
    'token mint to take as payment instead of sol',
  )
  .action(async (_, cmd) => {
    const {
      keypair,
      env,
      priceRangeStart,
      priceRangeEnd,
      phaseOneStartDate,
      phaseOneEndDate,
      phaseTwoEndDate,
      tickSize,
      numberOfTokens,
      fee,
      mint,
      uuid,
      selfDestructDate,
      antiRugTokenRequirement,
      antiRugReserveBp,
    } = cmd.opts();
    const antiRugTokenRequirementNumber = antiRugTokenRequirement
      ? parseInt(antiRugTokenRequirement)
      : null;
    const antiRugReserveBpNumber = antiRugReserveBp
      ? parseFloat(antiRugReserveBp)
      : null;
    const selfDestructDateActual = selfDestructDate
      ? Date.parse(selfDestructDate) / 1000
      : null;

    const antiRug =
      antiRugTokenRequirementNumber &&
      antiRugReserveBpNumber &&
      selfDestructDateActual
        ? {
            reserveBp: antiRugReserveBpNumber,
            tokenRequirement: antiRugTokenRequirementNumber,
            selfDestructDate: selfDestructDateActual,
          }
        : null;

    const parsedNumber = parseInt(numberOfTokens);
    let priceRangeStartNumber = parseFloat(priceRangeStart);
    let priceRangeEndNumber = parseFloat(priceRangeEnd);
    let tickSizeNumber = parseFloat(tickSize);
    let feeNumber = parseFloat(fee);
    const realUuid = uuid.slice(0, 6);
    const phaseOneStartDateActual =
      (phaseOneStartDate ? Date.parse(phaseOneStartDate) : Date.now()) / 1000;
    const phaseOneEndDateActual =
      (phaseOneEndDate ? Date.parse(phaseOneEndDate) : Date.now() + 86400000) /
      1000;
    const phaseTwoEndDateActual =
      (phaseTwoEndDate
        ? Date.parse(phaseTwoEndDate)
        : Date.now() + 2 * 86400000) / 1000;

    if (!mint) {
      priceRangeStartNumber = Math.ceil(
        priceRangeStartNumber * LAMPORTS_PER_SOL,
      );
      priceRangeEndNumber = Math.ceil(priceRangeEndNumber * LAMPORTS_PER_SOL);
      tickSizeNumber = Math.ceil(tickSizeNumber * LAMPORTS_PER_SOL);
      feeNumber = Math.ceil(feeNumber * LAMPORTS_PER_SOL);
    }

    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadFairLaunchProgram(walletKeyPair, env);
    const [tokenMint, tokenBump] = await getTokenMint(
      walletKeyPair.publicKey,
      realUuid,
    );
    const [fairLaunch, fairLaunchBump] = await getFairLaunch(tokenMint);
    const [treasury, treasuryBump] = await getTreasury(tokenMint);
    console.log('Mint is', mint);
    const remainingAccounts = !mint
      ? []
      : [
          {
            pubkey: new anchor.web3.PublicKey(mint),
            isWritable: false,
            isSigner: false,
          },
        ];
    await anchorProgram.rpc.initializeFairLaunch(
      fairLaunchBump,
      treasuryBump,
      tokenBump,
      {
        uuid: realUuid,
        priceRangeStart: new anchor.BN(priceRangeStartNumber),
        priceRangeEnd: new anchor.BN(priceRangeEndNumber),
        phaseOneStart: new anchor.BN(phaseOneStartDateActual),
        phaseOneEnd: new anchor.BN(phaseOneEndDateActual),
        phaseTwoEnd: new anchor.BN(phaseTwoEndDateActual),
        tickSize: new anchor.BN(tickSizeNumber),
        numberOfTokens: new anchor.BN(parsedNumber),
        fee: new anchor.BN(feeNumber),
        antiRugSetting: antiRug,
      },
      {
        accounts: {
          fairLaunch,
          tokenMint,
          treasury,
          authority: walletKeyPair.publicKey,
          payer: walletKeyPair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        remainingAccounts,
        signers: [],
      },
    );

    console.log(`create fair launch Done: ${fairLaunch.toBase58()}`);
  });

program
  .command('update_fair_launch')
  .option(
    '-e, --env <string>',
    'Solana cluster env name',
    'devnet', //mainnet-beta, testnet, devnet
  )
  .option(
    '-k, --keypair <path>',
    `Solana wallet location`,
    '--keypair not provided',
  )
  .option('-u, --uuid <string>', 'uuid')
  .option('-f, --fee <string>', 'price range end', '2')
  .option('-s, --price-range-start <string>', 'price range start', '1')
  .option('-e, --price-range-end <string>', 'price range end', '2')
  .option(
    '-arbp, --anti-rug-reserve-bp <string>',
    'optional anti-rug treasury reserve basis points (1-10000)',
  )
  .option(
    '-atc, --anti-rug-token-requirement <string>',
    'optional anti-rug token requirement when reserve opens - 100 means 100 tokens remaining out of total supply',
  )
  .option(
    '-sd, --self-destruct-date <string>',
    'optional date when funds from anti-rug setting will be returned - eg "04 Dec 1995 00:12:00 GMT"',
  )
  .option(
    '-pos, --phase-one-start-date <string>',
    'timestamp - eg "04 Dec 1995 00:12:00 GMT"',
  )
  .option(
    '-poe, --phase-one-end-date <string>',
    'timestamp - eg "04 Dec 1995 00:12:00 GMT"',
  )
  .option(
    '-pte, --phase-two-end-date <string>',
    'timestamp - eg "04 Dec 1995 00:12:00 GMT"',
  )
  .option('-ts, --tick-size <string>', 'tick size', '0.1')
  .option('-n, --number-of-tokens <number>', 'Number of tokens to sell')
  .option(
    '-mint, --token-mint <string>',
    'token mint to take as payment instead of sol',
  )
  .action(async (_, cmd) => {
    const {
      keypair,
      env,
      priceRangeStart,
      priceRangeEnd,
      phaseOneStartDate,
      phaseOneEndDate,
      phaseTwoEndDate,
      tickSize,
      numberOfTokens,
      fee,
      mint,
      uuid,
      selfDestructDate,
      antiRugTokenRequirement,
      antiRugReserveBp,
    } = cmd.opts();
    const antiRugTokenRequirementNumber = antiRugTokenRequirement
      ? parseInt(antiRugTokenRequirement)
      : null;
    const antiRugReserveBpNumber = antiRugReserveBp
      ? parseFloat(antiRugReserveBp)
      : null;
    const selfDestructDateActual = selfDestructDate
      ? Date.parse(selfDestructDate) / 1000
      : null;

    const antiRug =
      antiRugTokenRequirementNumber &&
      antiRugReserveBpNumber &&
      selfDestructDateActual
        ? {
            reserveBp: antiRugReserveBpNumber,
            tokenRequirement: antiRugTokenRequirementNumber,
            selfDestructDate: selfDestructDateActual,
          }
        : null;
    const parsedNumber = parseInt(numberOfTokens);
    let priceRangeStartNumber = parseFloat(priceRangeStart);
    let priceRangeEndNumber = parseFloat(priceRangeEnd);
    let tickSizeNumber = parseFloat(tickSize);
    let feeNumber = parseFloat(fee);
    const realUuid = uuid.slice(0, 6);
    const phaseOneStartDateActual =
      (phaseOneStartDate ? Date.parse(phaseOneStartDate) : Date.now()) / 1000;
    const phaseOneEndDateActual =
      (phaseOneEndDate ? Date.parse(phaseOneEndDate) : Date.now() + 86400000) /
      1000;
    const phaseTwoEndDateActual =
      (phaseTwoEndDate
        ? Date.parse(phaseTwoEndDate)
        : Date.now() + 2 * 86400000) / 1000;

    if (!mint) {
      priceRangeStartNumber = Math.ceil(
        priceRangeStartNumber * LAMPORTS_PER_SOL,
      );
      priceRangeEndNumber = Math.ceil(priceRangeEndNumber * LAMPORTS_PER_SOL);
      tickSizeNumber = Math.ceil(tickSizeNumber * LAMPORTS_PER_SOL);
      feeNumber = Math.ceil(feeNumber * LAMPORTS_PER_SOL);
    }

    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadFairLaunchProgram(walletKeyPair, env);
    const tokenMint = (
      await getTokenMint(walletKeyPair.publicKey, realUuid)
    )[0];
    const fairLaunch = (await getFairLaunch(tokenMint))[0];

    await anchorProgram.rpc.updateFairLaunch(
      {
        uuid: realUuid,
        priceRangeStart: new anchor.BN(priceRangeStartNumber),
        priceRangeEnd: new anchor.BN(priceRangeEndNumber),
        phaseOneStart: new anchor.BN(phaseOneStartDateActual),
        phaseOneEnd: new anchor.BN(phaseOneEndDateActual),
        phaseTwoEnd: new anchor.BN(phaseTwoEndDateActual),
        tickSize: new anchor.BN(tickSizeNumber),
        numberOfTokens: new anchor.BN(parsedNumber),
        fee: new anchor.BN(feeNumber),
        antiRugSetting: antiRug,
      },
      {
        accounts: {
          fairLaunch,
          authority: walletKeyPair.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        },
      },
    );

    console.log(`Updated fair launch Done: ${fairLaunch.toBase58()}`);
  });

program
  .command('purchase_ticket')
  .option(
    '-e, --env <string>',
    'Solana cluster env name',
    'devnet', //mainnet-beta, testnet, devnet
  )
  .option(
    '-k, --keypair <path>',
    `Solana wallet location`,
    '--keypair not provided',
  )
  .option('-f, --fair-launch <string>', 'fair launch id')
  .option('-a, --amount <string>', 'amount')
  .action(async (_, cmd) => {
    const { env, keypair, fairLaunch, amount } = cmd.opts();
    let amountNumber = parseFloat(amount);

    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadFairLaunchProgram(walletKeyPair, env);

    const fairLaunchKey = new anchor.web3.PublicKey(fairLaunch);
    const fairLaunchObj = await anchorProgram.account.fairLaunch.fetch(
      fairLaunchKey,
    );
    const [fairLaunchTicket, bump] = await getFairLaunchTicket(
      //@ts-ignore
      fairLaunchObj.tokenMint,
      walletKeyPair.publicKey,
    );

    const remainingAccounts = [];
    const instructions = [];
    const signers = [];

    //@ts-ignore
    if (!fairLaunchObj.treasuryMint) {
      amountNumber = Math.ceil(amountNumber * LAMPORTS_PER_SOL);
    } else {
      const transferAuthority = anchor.web3.Keypair.generate();
      signers.push(transferAuthority);

      instructions.push(
        Token.createApproveInstruction(
          TOKEN_PROGRAM_ID,
          //@ts-ignore
          fairLaunchObj.treasuryMint,
          transferAuthority.publicKey,
          walletKeyPair.publicKey,
          [],
          //@ts-ignore
          amountNumber + fairLaunchObj.data.fees.toNumber(),
        ),
      );

      remainingAccounts.push({
        //@ts-ignore
        pubkey: fairLaunchObj.treasuryMint,
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: (
          await getAtaForMint(
            //@ts-ignore
            fairLaunchObj.treasuryMint,
            walletKeyPair.publicKey,
          )
        )[0],
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: transferAuthority.publicKey,
        isWritable: false,
        isSigner: true,
      });
      remainingAccounts.push({
        pubkey: TOKEN_PROGRAM_ID,
        isWritable: false,
        isSigner: false,
      });
    }

    await anchorProgram.rpc.purchaseTicket(bump, new anchor.BN(amountNumber), {
      accounts: {
        fairLaunchTicket,
        fairLaunch,
        //@ts-ignore
        treasury: fairLaunchObj.treasury,
        buyer: walletKeyPair.publicKey,
        payer: walletKeyPair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      },
      //__private: { logAccounts: true },
      remainingAccounts,
      signers,
      instructions: instructions.length > 0 ? instructions : undefined,
    });

    console.log(
      `create fair launch ticket Done: ${fairLaunchTicket.toBase58()}. Trying to create seq now...we may or may not get a validator with data on chain. Either way, your ticket is secure.`,
    );

    await sleep(5000);
    const fairLaunchTicketObj =
      await anchorProgram.account.fairLaunchTicket.fetch(fairLaunchTicket);

    const [fairLaunchTicketSeqLookup, seqBump] =
      await getFairLaunchTicketSeqLookup(
        //@ts-ignore
        fairLaunchObj.tokenMint,
        //@ts-ignore
        fairLaunchTicketObj.seq,
      );

    await anchorProgram.rpc.createTicketSeq(seqBump, {
      accounts: {
        fairLaunchTicketSeqLookup,
        fairLaunch,
        fairLaunchTicket,
        payer: walletKeyPair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [],
    });

    console.log('Created seq');
  });

program
  .command('adjust_ticket')
  .option(
    '-e, --env <string>',
    'Solana cluster env name',
    'devnet', //mainnet-beta, testnet, devnet
  )
  .option(
    '-k, --keypair <path>',
    `Solana wallet location`,
    '--keypair not provided',
  )
  .option('-f, --fair-launch <string>', 'fair launch id')
  .option('-a, --amount <string>', 'amount')
  .action(async (_, cmd) => {
    const { env, keypair, fairLaunch, amount } = cmd.opts();
    let amountNumber = parseFloat(amount);

    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadFairLaunchProgram(walletKeyPair, env);

    const fairLaunchKey = new anchor.web3.PublicKey(fairLaunch);
    const fairLaunchObj = await anchorProgram.account.fairLaunch.fetch(
      fairLaunchKey,
    );
    const fairLaunchTicket = (
      await getFairLaunchTicket(
        //@ts-ignore
        fairLaunchObj.tokenMint,
        walletKeyPair.publicKey,
      )
    )[0];

    const fairLaunchLotteryBitmap = ( //@ts-ignore
      await getFairLaunchLotteryBitmap(fairLaunchObj.tokenMint)
    )[0];

    const remainingAccounts = [];
    const instructions = [];
    const signers = [];

    //@ts-ignore
    if (!fairLaunchObj.treasuryMint) {
      amountNumber = Math.ceil(amountNumber * LAMPORTS_PER_SOL);
    } else {
      const transferAuthority = anchor.web3.Keypair.generate();
      signers.push(transferAuthority);

      instructions.push(
        Token.createApproveInstruction(
          TOKEN_PROGRAM_ID,
          //@ts-ignore
          fairLaunchObj.treasuryMint,
          transferAuthority.publicKey,
          walletKeyPair.publicKey,
          [],
          //@ts-ignore
          amountNumber + fairLaunchObj.data.fees.toNumber(),
        ),
      );

      remainingAccounts.push({
        //@ts-ignore
        pubkey: fairLaunchObj.treasuryMint,
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: (
          await getAtaForMint(
            //@ts-ignore
            fairLaunchObj.treasuryMint,
            walletKeyPair.publicKey,
          )
        )[0],
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: transferAuthority.publicKey,
        isWritable: false,
        isSigner: true,
      });
      remainingAccounts.push({
        pubkey: TOKEN_PROGRAM_ID,
        isWritable: false,
        isSigner: false,
      });
    }

    await anchorProgram.rpc.adjustTicket(new anchor.BN(amountNumber), {
      accounts: {
        fairLaunchTicket,
        fairLaunch,
        fairLaunchLotteryBitmap,
        //@ts-ignore
        treasury: fairLaunchObj.treasury,
        buyer: walletKeyPair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      },
      //__private: { logAccounts: true },
      remainingAccounts,
      signers,
      instructions: instructions.length > 0 ? instructions : undefined,
    });

    console.log(
      `update fair launch ticket Done: ${fairLaunchTicket.toBase58()}.`,
    );
  });

program
  .command('start_phase_three')
  .option(
    '-e, --env <string>',
    'Solana cluster env name',
    'devnet', //mainnet-beta, testnet, devnet
  )
  .option(
    '-k, --keypair <path>',
    `Solana wallet location`,
    '--keypair not provided',
  )
  .option('-f, --fair-launch <string>', 'fair launch id')
  .action(async (_, cmd) => {
    const { env, keypair, fairLaunch } = cmd.opts();

    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadFairLaunchProgram(walletKeyPair, env);

    const fairLaunchKey = new anchor.web3.PublicKey(fairLaunch);
    const fairLaunchObj = await anchorProgram.account.fairLaunch.fetch(
      fairLaunchKey,
    );
    const fairLaunchLotteryBitmap = ( //@ts-ignore
      await getFairLaunchLotteryBitmap(fairLaunchObj.tokenMint)
    )[0];

    await anchorProgram.rpc.startPhaseThree({
      accounts: {
        fairLaunch,
        fairLaunchLotteryBitmap,
        authority: walletKeyPair.publicKey,
      },
    });

    console.log(`Dang son, phase three.`);
  });

program
  .command('create_fair_launch_lottery')
  .option(
    '-e, --env <string>',
    'Solana cluster env name',
    'devnet', //mainnet-beta, testnet, devnet
  )
  .option(
    '-k, --keypair <path>',
    `Solana wallet location`,
    '--keypair not provided',
  )
  .option('-f, --fair-launch <string>', 'fair launch id')
  .action(async (_, cmd) => {
    const { env, keypair, fairLaunch } = cmd.opts();
    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadFairLaunchProgram(walletKeyPair, env);

    const fairLaunchKey = new anchor.web3.PublicKey(fairLaunch);
    const fairLaunchObj = await anchorProgram.account.fairLaunch.fetch(
      fairLaunchKey,
    );

    const [fairLaunchLotteryBitmap, bump] = await getFairLaunchLotteryBitmap(
      //@ts-ignore
      fairLaunchObj.tokenMint,
    );

    const exists = await anchorProgram.provider.connection.getAccountInfo(
      fairLaunchLotteryBitmap,
    );
    if (!exists) {
      await anchorProgram.rpc.createFairLaunchLotteryBitmap(bump, {
        accounts: {
          fairLaunch,
          fairLaunchLotteryBitmap,
          authority: walletKeyPair.publicKey,
          payer: walletKeyPair.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        },
      });

      console.log(
        `created fair launch lottery bitmap Done: ${fairLaunchLotteryBitmap.toBase58()}.`,
      );
    } else {
      console.log(
        `checked fair launch lottery bitmap, exists: ${fairLaunchLotteryBitmap.toBase58()}.`,
      );
    }

    const seqKeys = [];
    //@ts-ignore
    for (let i = 0; i < fairLaunchObj.numberTicketsSold; i++) {
      seqKeys.push(
        (
          await getFairLaunchTicketSeqLookup(
            //@ts-ignore
            fairLaunchObj.tokenMint,
            new anchor.BN(i),
          )
        )[0],
      );
    }

    const ticketKeys: anchor.web3.PublicKey[][] = await Promise.all(
      chunks(Array.from(Array(seqKeys.length).keys()), 1000).map(
        async allIndexesInSlice => {
          let ticketKeys = [];
          for (let i = 0; i < allIndexesInSlice.length; i += 100) {
            console.log(
              'Pulling ticket seqs for slice',
              allIndexesInSlice[i],
              allIndexesInSlice[i + 100],
            );
            const slice = allIndexesInSlice
              .slice(i, i + 100)
              .map(index => seqKeys[index]);
            const result = await getMultipleAccounts(
              anchorProgram.provider.connection,
              slice.map(s => s.toBase58()),
              'recent',
            );
            ticketKeys = ticketKeys.concat(
              result.array.map(
                a =>
                  new anchor.web3.PublicKey(
                    new Uint8Array(a.data.slice(8, 8 + 32)),
                  ),
              ),
            );
            return ticketKeys;
          }
        },
      ),
    );

    const ticketsFlattened = ticketKeys.flat();

    const states: { seq: anchor.BN; eligible: boolean }[][] = await Promise.all(
      chunks(Array.from(Array(ticketsFlattened.length).keys()), 1000).map(
        async allIndexesInSlice => {
          let states = [];
          for (let i = 0; i < allIndexesInSlice.length; i += 100) {
            console.log(
              'Pulling states for slice',
              allIndexesInSlice[i],
              allIndexesInSlice[i + 100],
            );
            const slice = allIndexesInSlice
              .slice(i, i + 100)
              .map(index => ticketsFlattened[index]);
            const result = await getMultipleAccounts(
              anchorProgram.provider.connection,
              slice.map(s => s.toBase58()),
              'recent',
            );
            states = states.concat(
              result.array.map(a => ({
                seq: new anchor.BN(
                  a.data.slice(
                    FAIR_LAUNCH_TICKET_SEQ_LOC,
                    FAIR_LAUNCH_TICKET_SEQ_LOC + 8,
                  ),
                  undefined,
                  'le',
                ),
                eligible:
                  a.data[FAIR_LAUNCH_TICKET_STATE_LOC] == 1 &&
                  new anchor.BN(
                    a.data.slice(
                      FAIR_LAUNCH_TICKET_AMOUNT_LOC,
                      FAIR_LAUNCH_TICKET_AMOUNT_LOC + 8,
                    ),
                    undefined,
                    'le',
                    //@ts-ignore
                  ).toNumber() >= fairLaunchObj.currentMedian.toNumber(),
              })),
            );
            return states;
          }
        },
      ),
    );

    const statesFlat = states.flat();

    //@ts-ignore;
    let numWinnersRemaining = fairLaunchObj.data.numberOfTokens;

    let chosen: { seq: anchor.BN; eligible: boolean; chosen: boolean }[];
    if (numWinnersRemaining >= statesFlat.length) {
      console.log('More or equal nfts than winners, everybody wins.');
      chosen = statesFlat.map(s => ({ ...s, chosen: true }));
    } else {
      console.log('Doing lottery.');
      chosen = statesFlat.map(s => ({ ...s, chosen: false }));
      while (numWinnersRemaining > 0) {
        const rand = Math.round(Math.random() * (chosen.length - 1));
        if (chosen[rand].chosen != true && chosen[rand].eligible) {
          chosen[rand].chosen = true;
          numWinnersRemaining--;
        }
      }
    }
    const sorted = chosen.sort((a, b) => a.seq.toNumber() - b.seq.toNumber());
    console.log('Lottery results', sorted);

    await Promise.all(
      // each 8 entries is 1 byte, we want to send up 1000 bytes at a time.
      // be specific here.
      chunks(Array.from(Array(sorted.length).keys()), 8 * 1000).map(
        async allIndexesInSlice => {
          const bytes = [];
          const correspondingArrayOfBits = [];
          const startingOffset = allIndexesInSlice[0];
          let positionFromRight = 7;
          let currByte = 0;
          let currByteAsBits = [];
          for (let i = 0; i < allIndexesInSlice.length; i++) {
            if (chosen[allIndexesInSlice[i]].chosen) {
              const mask = Math.pow(2, positionFromRight);
              currByte = currByte | mask;
              currByteAsBits.push(1);
            } else {
              currByteAsBits.push(0);
            }
            positionFromRight--;
            if (positionFromRight < 0) {
              bytes.push(currByte);
              correspondingArrayOfBits.push(currByteAsBits);
              currByte = 0;
              currByteAsBits = [];
              positionFromRight = 7;
            }
          }

          if (positionFromRight != 7) {
            // grab the last one if the loop hasnt JUST ended exactly right before on an additional add.
            bytes.push(currByte);
            correspondingArrayOfBits.push(currByteAsBits);
          }

          console.log(
            'Setting bytes array for',
            startingOffset,
            'to',
            allIndexesInSlice[allIndexesInSlice.length - 1],
            'as (with split out by bits for ease of reading)',
            bytes.map((e, i) => [e, correspondingArrayOfBits[i]]),
          );

          await anchorProgram.rpc.updateFairLaunchLotteryBitmap(
            startingOffset,
            Buffer.from(bytes),
            {
              accounts: {
                fairLaunch,
                fairLaunchLotteryBitmap,
                authority: walletKeyPair.publicKey,
              },
            },
          );
        },
      ),
    );

    console.log('All done');
  });

program
  .command('create_missing_sequences')
  .option(
    '-e, --env <string>',
    'Solana cluster env name',
    'devnet', //mainnet-beta, testnet, devnet
  )
  .option(
    '-k, --keypair <path>',
    `Solana wallet location`,
    '--keypair not provided',
  )
  .option('-f, --fair-launch <string>', 'fair launch id')
  .action(async (_, cmd) => {
    const { env, keypair, fairLaunch } = cmd.opts();
    const fairLaunchTicketSeqStart = 8 + 32 + 32 + 8 + 1 + 1;
    const fairLaunchTicketState = 8 + 32 + 32 + 8;
    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadFairLaunchProgram(walletKeyPair, env);
    const fairLaunchObj = await anchorProgram.account.fairLaunch.fetch(
      fairLaunch,
    );
    const tickets = await anchorProgram.provider.connection.getProgramAccounts(
      FAIR_LAUNCH_PROGRAM_ID,
      {
        filters: [
          {
            memcmp: {
              offset: 8,
              bytes: fairLaunch,
            },
          },
        ],
      },
    );

    for (let i = 0; i < tickets.length; i++) {
      const accountAndPubkey = tickets[i];
      const { account, pubkey } = accountAndPubkey;
      const state = account.data[fairLaunchTicketState];
      if (state == 0) {
        console.log('Missing sequence for ticket', pubkey.toBase58());
        const [fairLaunchTicketSeqLookup, seqBump] =
          await getFairLaunchTicketSeqLookup(
            //@ts-ignore
            fairLaunchObj.tokenMint,
            new anchor.BN(
              account.data.slice(
                fairLaunchTicketSeqStart,
                fairLaunchTicketSeqStart + 8,
              ),
              undefined,
              'le',
            ),
          );

        await anchorProgram.rpc.createTicketSeq(seqBump, {
          accounts: {
            fairLaunchTicketSeqLookup,
            fairLaunch,
            fairLaunchTicket: pubkey,
            payer: walletKeyPair.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          },
          signers: [],
        });
        console.log('Created...');
      }
    }
  });

program
  .command('show')
  .option(
    '-e, --env <string>',
    'Solana cluster env name',
    'devnet', //mainnet-beta, testnet, devnet
  )
  .option(
    '-k, --keypair <path>',
    `Solana wallet location`,
    '--keypair not provided',
  )
  .option('-f, --fair-launch <string>', 'fair launch id')
  .action(async (options, cmd) => {
    const { env, fairLaunch, keypair } = cmd.opts();

    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadFairLaunchProgram(walletKeyPair, env);

    const fairLaunchObj = await anchorProgram.account.fairLaunch.fetch(
      fairLaunch,
    );

    let treasuryAmount = 0;
    // @ts-ignore
    if (fairLaunchObj.treasuryMint) {
      const token =
        await anchorProgram.provider.connection.getTokenAccountBalance(
          // @ts-ignore
          fairLaunchObj.treasury,
        );
      treasuryAmount = token.value.uiAmount;
    } else {
      treasuryAmount = await anchorProgram.provider.connection.getBalance(
        // @ts-ignore
        fairLaunchObj.treasury,
      );
    }

    //@ts-ignore
    console.log('Token Mint', fairLaunchObj.tokenMint.toBase58());
    //@ts-ignore
    console.log('Treasury', fairLaunchObj.treasury.toBase58());
    //@ts-ignore
    console.log('Treasury Mint', fairLaunchObj.treasuryMint?.toBase58());
    //@ts-ignore
    console.log('Authority', fairLaunchObj.authority.toBase58());
    //@ts-ignore
    console.log('Bump', fairLaunchObj.bump);
    //@ts-ignore
    console.log('Treasury Bump', fairLaunchObj.treasuryBump);
    //@ts-ignore
    console.log('Token Mint Bump', fairLaunchObj.tokenMintBump);
    console.log(
      'Price Range Start        ',
      //@ts-ignore
      fairLaunchObj.data.priceRangeStart.toNumber(),
    );
    console.log(
      'Price Range End          ',
      //@ts-ignore
      fairLaunchObj.data.priceRangeEnd.toNumber(),
    );

    console.log(
      'Tick Size                ',
      //@ts-ignore
      fairLaunchObj.data.tickSize.toNumber(),
    );

    console.log(
      'Fees                     ',
      //@ts-ignore
      fairLaunchObj.data.fee.toNumber(),
    );

    console.log('Current Treasury Holdings', treasuryAmount);

    console.log(
      'Phase One Start',
      //@ts-ignore
      new Date(fairLaunchObj.data.phaseOneStart.toNumber() * 1000),
    );
    console.log(
      'Phase One End  ',
      //@ts-ignore
      new Date(fairLaunchObj.data.phaseOneEnd.toNumber() * 1000),
    );
    console.log(
      'Phase Two End  ',
      //@ts-ignore
      new Date(fairLaunchObj.data.phaseTwoEnd.toNumber() * 1000),
    );

    console.log(
      'Number of Tokens',
      //@ts-ignore
      fairLaunchObj.data.numberOfTokens.toNumber(),
    );

    console.log(
      'Number of Tickets Un-Sequenced     ',
      //@ts-ignore
      fairLaunchObj.numberTicketsUnSeqed.toNumber(),
    );

    console.log(
      'Number of Tickets Sold             ',
      //@ts-ignore
      fairLaunchObj.numberTicketsSold.toNumber(),
    );

    console.log(
      'Number of Tickets Dropped          ',
      //@ts-ignore
      fairLaunchObj.numberTicketsDropped.toNumber(),
    );

    console.log(
      'Number of Tickets Punched          ',
      //@ts-ignore
      fairLaunchObj.numberTicketsPunched.toNumber(),
    );

    console.log(
      'Number of Tickets Dropped + Punched',
      //@ts-ignore
      fairLaunchObj.numberTicketsDropped.toNumber() +
        //@ts-ignore
        fairLaunchObj.numberTicketsPunched.toNumber(),
    );

    console.log(
      'Phase Three Started',
      //@ts-ignore
      fairLaunchObj.phaseThreeStarted,
    );

    console.log(
      'Current Median',
      //@ts-ignore
      fairLaunchObj.currentMedian.toNumber(),
    );

    console.log('Counts at Each Tick');
    //@ts-ignore
    fairLaunchObj.countsAtEachTick.forEach((c, i) =>
      console.log(
        //@ts-ignore
        fairLaunchObj.data.priceRangeStart.toNumber() +
          //@ts-ignore
          i * fairLaunchObj.data.tickSize.toNumber(),
        ':',
        c.toNumber(),
      ),
    );
  });

program
  .command('show_ticket')
  .option(
    '-e, --env <string>',
    'Solana cluster env name',
    'devnet', //mainnet-beta, testnet, devnet
  )
  .option(
    '-k, --keypair <path>',
    `Solana wallet location`,
    '--keypair not provided',
  )
  .option('-f, --fair-launch <string>', 'fair launch id')
  .action(async (options, cmd) => {
    const { env, fairLaunch, keypair } = cmd.opts();

    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadFairLaunchProgram(walletKeyPair, env);

    const fairLaunchObj = await anchorProgram.account.fairLaunch.fetch(
      fairLaunch,
    );

    const fairLaunchTicket = (
      await getFairLaunchTicket(
        //@ts-ignore
        fairLaunchObj.tokenMint,
        walletKeyPair.publicKey,
      )
    )[0];

    const fairLaunchTicketObj =
      await anchorProgram.account.fairLaunchTicket.fetch(fairLaunchTicket);

    //@ts-ignore
    console.log('Buyer', fairLaunchTicketObj.buyer.toBase58());
    //@ts-ignore
    console.log('Fair Launch', fairLaunchTicketObj.fairLaunch.toBase58());
    //@ts-ignore
    console.log('Current Amount', fairLaunchTicketObj.amount.toNumber());
    //@ts-ignore
    console.log('State', fairLaunchTicketObj.state);
    //@ts-ignore
    console.log('Bump', fairLaunchTicketObj.bump);
    //@ts-ignore
    console.log('Sequence', fairLaunchTicketObj.seq.toNumber());
  });

program
  .command('show_lottery')
  .option(
    '-e, --env <string>',
    'Solana cluster env name',
    'devnet', //mainnet-beta, testnet, devnet
  )
  .option(
    '-k, --keypair <path>',
    `Solana wallet location`,
    '--keypair not provided',
  )
  .option('-f, --fair-launch <string>', 'fair launch id')
  .action(async (options, cmd) => {
    const { env, fairLaunch, keypair } = cmd.opts();

    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadFairLaunchProgram(walletKeyPair, env);

    const fairLaunchObj = await anchorProgram.account.fairLaunch.fetch(
      fairLaunch,
    );

    const fairLaunchLottery = (
      await getFairLaunchLotteryBitmap(
        //@ts-ignore
        fairLaunchObj.tokenMint,
      )
    )[0];

    const fairLaunchLotteryBitmapObj =
      await anchorProgram.provider.connection.getAccountInfo(fairLaunchLottery);

    const fairLaunchLotteryBitmapAnchorObj =
      await anchorProgram.account.fairLaunchLotteryBitmap.fetch(
        fairLaunchLottery,
      );
    const seqKeys = [];
    //@ts-ignore
    for (let i = 0; i < fairLaunchObj.numberTicketsSold; i++) {
      seqKeys.push(
        (
          await getFairLaunchTicketSeqLookup(
            //@ts-ignore
            fairLaunchObj.tokenMint,
            new anchor.BN(i),
          )
        )[0],
      );
    }
    const buyers: { seq: anchor.BN; buyer: anchor.web3.PublicKey }[][] =
      await Promise.all(
        chunks(Array.from(Array(seqKeys.length).keys()), 1000).map(
          async allIndexesInSlice => {
            let ticketKeys = [];
            for (let i = 0; i < allIndexesInSlice.length; i += 100) {
              console.log(
                'Pulling ticket seqs for slice',
                allIndexesInSlice[i],
                allIndexesInSlice[i + 100],
              );
              const slice = allIndexesInSlice
                .slice(i, i + 100)
                .map(index => seqKeys[index]);
              const result = await getMultipleAccounts(
                anchorProgram.provider.connection,
                slice.map(s => s.toBase58()),
                'recent',
              );
              ticketKeys = ticketKeys.concat(
                result.array.map(a => ({
                  buyer: new anchor.web3.PublicKey(
                    new Uint8Array(a.data.slice(8 + 32, 8 + 32 + 32)),
                  ),
                  seq: new anchor.BN(
                    a.data.slice(8 + 32 + 32, 8 + 32 + 32 + 8),
                    undefined,
                    'le',
                  ),
                })),
              );

              return ticketKeys;
            }
          },
        ),
      );

    const buyersFlattened = buyers
      .flat()
      .sort((a, b) => a.seq.toNumber() - b.seq.toNumber());

    for (let i = 0; i < buyersFlattened.length; i++) {
      const buyer = buyersFlattened[i];

      const myByte =
        fairLaunchLotteryBitmapObj.data[
          FAIR_LAUNCH_LOTTERY_SIZE + Math.floor(buyer.seq.toNumber() / 8)
        ];

      const positionFromRight = 7 - (buyer.seq.toNumber() % 8);
      const mask = Math.pow(2, positionFromRight);
      const isWinner = myByte & mask;
      console.log(
        'Ticket',
        buyer.seq,
        buyer.buyer.toBase58(),
        isWinner > 0 ? 'won' : 'lost',
      );
    }

    console.log(
      'Bit Map ones',
      //@ts-ignore
      fairLaunchLotteryBitmapAnchorObj.bitmapOnes.toNumber(),
    );
  });
program.parse(process.argv);
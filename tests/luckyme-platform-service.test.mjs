import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { createPromotionalPoolsService } from "../backend/src/promotional-pools-service.mjs";
import { createLuckyMePlatformService } from "../backend/src/luckyme-platform-service.mjs";

function fixture() {
  let now = Date.parse("2026-07-23T08:00:00.000Z");
  const clock = () => now++;
  const points = createPromotionalPoolsService({
    dbPath: ":memory:",
    clock,
    chain: {},
  });
  const platform = createLuckyMePlatformService({
    db: points.db,
    pointsService: points,
    clock,
  });
  return { platform, points };
}

test("wallet profile receives a deterministic temporary username that can be finalized once", () => {
  const { platform } = fixture();
  const wallet = Keypair.generate().publicKey.toBase58();

  const initial = platform.profile(wallet);
  assert.match(initial.username, /^player_[a-f0-9]+$/);
  assert.equal(initial.usernameState.canCustomize, true);
  assert.equal(initial.luckyPoints, 0);

  const finalized = platform.finalizeUsername({
    wallet,
    username: "Victor_Lucky",
    permanenceAccepted: true,
    confirmation: "CONFIRM PERMANENT USERNAME",
  });
  assert.equal(finalized.username, "victor_lucky");
  assert.equal(finalized.usernameState.canCustomize, false);

  assert.throws(() => platform.finalizeUsername({
    wallet,
    username: "second_name",
    permanenceAccepted: true,
    confirmation: "CONFIRM PERMANENT USERNAME",
  }), (error) => error.code === "username_already_finalized");
});

test("default Discord and X missions are active and award points exactly once", () => {
  const { platform } = fixture();
  const wallet = Keypair.generate().publicKey.toBase58();
  platform.profile(wallet);

  const tasks = platform.listTasks(wallet);
  const discord = tasks.find((task) => task.platform === "discord");
  const x = tasks.find((task) => task.platform === "x");
  assert.equal(discord.rewardPoints, 5);
  assert.equal(x.rewardPoints, 5);

  const xChallenge = platform.beginXVerification({ wallet, taskId: x.id });
  const xSubmission = platform.submitXVerification({
    wallet,
    taskId: x.id,
    challengeId: xChallenge.id,
    handle: "@victor_lucky",
    postUrl: "https://x.com/victor_lucky/status/1234567890123456789",
  });
  assert.equal(xSubmission.status, "pending_review");
  assert.equal(platform.profile(wallet).luckyPoints, 0);

  const approved = platform.reviewTask({
    actor: "admin-test",
    submissionId: xSubmission.submissionId,
    decision: "approve",
  });
  assert.equal(approved.luckyPoints, 5);
  const replay = platform.reviewTask({
    actor: "admin-test",
    submissionId: xSubmission.submissionId,
    decision: "approve",
  });
  assert.equal(replay.replayed, true);
  assert.equal(platform.profile(wallet).luckyPoints, 5);

  const discordState = platform.beginDiscordOAuth({ wallet, taskId: discord.id });
  const discordResult = platform.completeDiscordOAuth({
    state: discordState.state,
    externalId: "123456789012345678",
    username: "Victor Lucky",
  });
  assert.equal(discordResult.luckyPoints, 10);
  assert.equal(platform.profile(wallet).tasks.completed, 2);
  assert.equal(platform.listUsers({ search: wallet })[0].luckyPoints, 10);
  const history = platform.missionHistory(wallet);
  assert.equal(history.length, 2);
  assert.equal(history.every((entry) => entry.status === "approved"), true);
  assert.equal(history.reduce((total, entry) => total + entry.awardedPoints, 0), 10);
  assert.equal(history.reduce((total, entry) => total + entry.awardedXp, 0) > 0, true);

  assert.throws(() => platform.completeDiscordOAuth({
    state: discordState.state,
    externalId: "123456789012345678",
    username: "Victor Lucky",
  }), (error) => error.code === "invalid_oauth_state");
});

test("a Discord identity cannot reward a second wallet", () => {
  const { platform } = fixture();
  const first = Keypair.generate().publicKey.toBase58();
  const second = Keypair.generate().publicKey.toBase58();
  const discord = platform.listTasks(first).find((task) => task.platform === "discord");

  const firstState = platform.beginDiscordOAuth({ wallet: first, taskId: discord.id });
  platform.completeDiscordOAuth({
    state: firstState.state,
    externalId: "987654321098765432",
    username: "Lucky Member",
  });

  const secondState = platform.beginDiscordOAuth({ wallet: second, taskId: discord.id });
  assert.throws(() => platform.completeDiscordOAuth({
    state: secondState.state,
    externalId: "987654321098765432",
    username: "Lucky Member",
  }), (error) => error.code === "identity_already_linked");
  assert.equal(platform.profile(second).luckyPoints, 0);
});

test("Admin can inspect and reactivate a suspended user while APK access stays blocked", () => {
  const { platform } = fixture();
  const wallet = Keypair.generate().publicKey.toBase58();
  platform.profile(wallet);
  platform.setUserStatus({ actor: "admin-test", wallet, status: "suspended" });

  assert.throws(
    () => platform.profile(wallet),
    (error) => error.code === "user_suspended",
  );
  assert.equal(platform.userDetails(wallet).status, "suspended");

  platform.setUserStatus({ actor: "admin-test", wallet, status: "active" });
  assert.equal(platform.profile(wallet).status, "active");
});

test("X action missions create official intents and closed tasks can be removed safely", () => {
  const { platform } = fixture();
  const wallet = Keypair.generate().publicKey.toBase58();
  const task = platform.createTask({
    actor: "admin-test",
    title: "Like the launch post",
    description: "Open X and confirm the Like action.",
    platform: "x",
    xAction: "like",
    targetUrl: "https://www.x.com/LuckyMe/status/1234567890123456789?ref=test",
    rewardPoints: 10,
  });

  assert.equal(task.actionType, "like");
  assert.equal(task.actionLabel, "Like this post");
  assert.equal(task.targetUrl, "https://x.com/LuckyMe/status/1234567890123456789");

  const challenge = platform.beginXVerification({ wallet, taskId: task.id });
  assert.equal(challenge.mode, "action");
  assert.equal(
    challenge.openUrl,
    "https://twitter.com/intent/like?tweet_id=1234567890123456789",
  );

  const submitted = platform.submitXVerification({
    wallet,
    taskId: task.id,
    challengeId: challenge.id,
    handle: "@victor_lucky",
  });
  assert.equal(submitted.status, "pending_review");
  platform.updateTask({ actor: "admin-test", taskId: task.id, status: "archived" });
  assert.throws(
    () => platform.deleteTask({ actor: "admin-test", taskId: task.id }),
    (error) => error.code === "task_has_pending_submissions",
  );

  platform.reviewTask({
    actor: "admin-test",
    submissionId: submitted.submissionId,
    decision: "approve",
  });
  const removed = platform.deleteTask({ actor: "admin-test", taskId: task.id });
  assert.equal(removed.deleted, true);
  assert.equal(platform.listTasks(null, { includeInactive: true }).some((entry) => entry.id === task.id), false);
  assert.equal(platform.userDetails(wallet).submissions.length, 1);
});

test("X Follow, Repost and Comment missions use the matching official intent", () => {
  const { platform } = fixture();
  const cases = [
    ["follow", "https://x.com/LuckyMe", "https://twitter.com/intent/follow?screen_name=LuckyMe"],
    ["repost", "https://x.com/LuckyMe/status/111", "https://twitter.com/intent/retweet?tweet_id=111"],
    ["comment", "https://x.com/LuckyMe/status/222", "https://twitter.com/intent/tweet?in_reply_to=222"],
  ];
  for (const [xAction, targetUrl, expected] of cases) {
    const task = platform.createTask({
      actor: "admin-test",
      title: `${xAction} LuckyMe`,
      description: `Complete the ${xAction} action on X.`,
      platform: "x",
      xAction,
      targetUrl,
      rewardPoints: 1,
    });
    const challenge = platform.beginXVerification({
      wallet: Keypair.generate().publicKey.toBase58(),
      taskId: task.id,
    });
    assert.equal(challenge.openUrl, expected);
  }
});

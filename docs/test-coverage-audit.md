# Test Coverage Audit — Core Runtime

Audit of integration test coverage for recent features in the core "runtime" path: collecting answers, auto/manual scoring, broadcasting to host/teams/watchers, and preserving scores across navigation/reconnection.

## Scope

**In scope:** backend `cargo test` integration tests in `backend/tests/integ/`. Playwright follows after.

**Out of scope for this pass:**
- Editor / trivia YAML routes (still in flux)
- Detailed settings × question-type matrix — its own future audit. See `memory/project_future_settings_audit.md`.

**Convention:** priorities are P0 (must-have, fills a coverage void), P1 (should-have, fills a gap in an existing area), P2 (nice-to-have, hardens an edge).

---

## Existing coverage snapshot (so we don't duplicate)

- **Numeric** — `numeric_scoring_test.rs`: exact / range linear / range flat / range percent / closest-guess (basic + ties) / config change recalculates / correct-answer change recalculates / clear correct answer / non-numeric rejection / bonus points / speed bonus. **Solid.**
- **Multi-answer** — `game.rs` unit tests cover grading logic (cardinality, duplicates, empty) and toggle re-grading. **No backend integ-level test file**, but covered well at the unit level and at Playwright level.
- **Multiple Choice** — exercised only as `default_question_type` in `settings_test.rs`. No dedicated integ test for MC answer flow, but the wire path is identical to Standard so coverage is largely shared.
- **Standard** — `answer_submission_test.rs`, `auto_scoring_test.rs` (auto-score matching answers, case-insensitivity, clearing-syncs, partial-points sync, different-answers-isolated, late submission auto-scored).
- **Speed bonus** — exercised in `numeric_scoring_test.rs::numeric_speed_bonus_applies` and `settings_test.rs::speed_bonus_toggle_works_after_scoring`. Frontend has a dedicated spec.
- **Navigation** — `question_navigation_test.rs`: skip-and-return, multi-question scoring preservation, prev-at-Q1 error, navigation-stops-timer, team broadcast.
- **Reconnection** — `team_reconnection_test.rs`: single-team, single-Standard-question score persistence. `host_reconnection_test.rs`: reclaim flow (has `TODO: Phase 2 - verify team can still submit answers`).
- **Watchers** — `watcher_test.rs`: initial scoreboard, team-join update, score-change update, override update, multi-watcher fanout.
- **Timer** — `game_timer_test.rs`: start/pause/reset/ticks, but **no test for auto-pause when all teams submit** (the behavior is *relied on* implicitly by `settings_test.rs` but never asserted).

---

## Gap 1 — Map question type (P0)

**Status:** zero backend integ coverage. `game.rs` has unit tests for `haversine_distance_km` and `calculate_map_score`, which cover the math but not the wire/state path. The user asked to skip Playwright for Map.

**What needs coverage (proposed `backend/tests/integ/map_scoring_test.rs`):**

1. **Switching question type to Map** — host sends `UpdateQuestionSettings { question_type: Map }`, state shows `QuestionConfig::Map { config: <default> }`, broadcast reaches team and watcher.
2. **Submitting valid coordinates auto-scores** — team submits `AnswerSubmission::Coordinates { lat, lng }`, host sets correct location, answer auto-scores from haversine math. Verify exact-match (full points), near-match (partial), far-match (~zero).
3. **Setting correct location AFTER submission triggers recalculation** — same as numeric: submit first, set location later, all answers get scored.
4. **Changing correct location recalculates** — analog of `numeric_correct_answer_change_recalculates`. Move correct location, scores update for all teams.
5. **Clearing correct location resets scores** — `SetMapCorrectLocation { correct_location: None }` zeroes everyone (mirrors `numeric_clearing_correct_answer_resets_scores`).
6. **Out-of-range coordinates rejected** — `lat > 90`, `lng > 180`, `lat = NaN`, etc. Should be silently rejected (the game.rs branch at L735–738 returns false).
7. **Wrong submission type rejected** — submitting `AnswerSubmission::Single("foo")` to a Map question is rejected.
8. **Map config change (`UpdateTypeSpecificSettings`) post-submission recalculates** — change `full_points_distance_km` / `zero_points_distance_km`, all scores update. The game.rs branch at L1386–1401 explicitly allows this.
9. **Speed bonus on Map** — two teams submit, both correct (above some point threshold), speed bonus applies in submission order. Analog of `numeric_speed_bonus_applies`.
10. **Manual bonus/override on Map answer** — `ScoreAnswer` against a Map question correctly applies bonus_points/override_points (the L916 branch passes through Numeric *and* Map should be checked — actually re-reading L916: only `MultiAnswer || Numeric` is special-cased. **Verify Map goes through the Standard branch** which tries to normalize text and will fail to match Coordinates content. This may be a behavior question, not just a test gap.)
11. **Watcher receives scoreboard update on Map score** — analog of `watcher_receives_update_when_score_changes` but with Map.
12. **Team's TeamGameState includes `question_config: Map` for historic Map questions** — navigation case: team submits Map answer on Q1, navigates to Q2, navigates back, `team.questions[0].question_config` is still Map.

**Risk areas surfaced while reading game.rs:**
- L913–931 special-cases Numeric/MultiAnswer in `score_answer` but **not** Map. A Map answer has `Coordinates` content; `normalize_answer_text` returns `None` for it, hitting the L941–956 early-return path. This may or may not be intentional — worth a test that pins down the current behavior so future refactors don't silently change it.

## Gap 2 — Auto-pause timer when all teams submit (P0)

**Status:** the feature (commit `3b96475`) is exercised implicitly — `settings_test.rs` line 287 has the comment "Timer auto-paused (all teams submitted)" but no test directly asserts the pause occurred. The whole feature could break silently.

**Implementation site:** `game.rs:779–787` — after a successful submission, checks `answers_count >= teams.len()` and calls `pause_timer`.

**Proposed tests (could live in `game_timer_test.rs` or new `auto_pause_test.rs`):**

1. **Auto-pause fires when last team submits** — 2 teams, both submit, assert timer pauses (host gets `GameState { timer_running: false }`, teams get `TeamGameState { timer_running: false }`).
2. **No auto-pause with partial submissions** — 3 teams, only 2 submit, timer keeps running. (Could verify a `TimerTick` arrives shortly after.)
3. **No auto-pause when no teams in game** — host with zero teams starts the timer; it does NOT immediately pause (the L784 check is `>=`, and `0 >= 0` is true — **this may be a subtle bug**: if a host starts a timer with no teams, the auto-pause check on submit never fires, but does the *initial* state get auto-paused? Looking at the code: no, auto-pause only runs after a `submitted: true` branch, so 0 teams + 0 submits = never pauses. Good. But we should write the test to lock this in.)
4. **Auto-pause works across question types** — same test on Standard, Numeric, Map (one each, single team submits → timer pauses). This catches any future regression where a new question type forgets to flow through the L780 check.
5. **Auto-pause broadcasts to watchers** — watcher gets `ScoreboardData { timer_running: false }`.
6. **Late-joining team doesn't break auto-pause math** — 2 teams submit, then 3rd team joins post-pause — does this matter? Probably we shouldn't auto-resume; verify behavior is sensible.

## Gap 3 — Score preservation across navigation, per question type (P1)

**Status:** `question_navigation_test.rs::navigation_preserves_answers_and_scores_across_questions` covers Standard only. Newer types have no equivalent.

**Proposed tests (could extend `question_navigation_test.rs` or live in each type's file):**

1. **Numeric: submit & auto-score on Q1, navigate to Q2, back to Q1 — answer & score preserved.**
2. **Map: same.**
3. **Multi-answer: submit on Q1, host toggles a pill correct, navigate away & back — both `correct[]` array and `question_points` preserved.**
4. **Mixed-type game**: Q1 Standard, Q2 Numeric, Q3 Map — each team answers each — navigate freely, scores stay consistent. (One bigger end-to-end test instead of three.)

## Gap 4 — Score preservation across team reconnection, per question type (P1)

**Status:** `team_reconnection_test.rs` only covers a single Standard-question, single-team flow.

**Proposed tests (extending `team_reconnection_test.rs`):**

1. **Reconnect after Numeric auto-scored answer** — score still in TeamData after reconnect, and the team's `TeamGameState.questions[0].score.question_points` matches.
2. **Reconnect after Map auto-scored answer.**
3. **Reconnect after Multi-answer with toggled-correct pills** — both score and `correct[]` flags preserved in team view.
4. **Reconnect mid-game with multiple scored questions** — team has scored answers on Q1 and Q3, disconnects, reconnects on Q2; cumulative score and per-question records all preserved.

## Gap 5 — Host reconnection: state actually survives + team can still play (P1)

**Status:** `host_reconnection_test.rs::host_disconnects_and_reconnects_teams_remain` has an explicit `TODO: Phase 2 - verify team can still submit answers` at line 49.

**Proposed test:** team is connected, host disconnects, team is still connected (verify no errant disconnect), host reconnects, team submits, host receives the answer, host scores it. End-to-end smoke that the reclaim flow doesn't silently break the message routes.

## Gap 6 — Map's `score_answer` behavior with manual bonus (P2)

**Status:** as flagged in Gap 1 #10 — `score_answer` (game.rs:891) has a special branch for `MultiAnswer || Numeric` at L916 that updates only `bonus_points` + `override_points`, but Map falls through to the Standard path which tries text matching on Coordinates content (returns None → early return with just speed-bonus + team recalc). It may be working correctly by accident, or there may be a bug. Either way, **lock current behavior in a test**.

**Proposed test:** Submit Map answer with correct location set → auto-scored. Host sends `ScoreAnswer { question_points: <should be ignored>, bonus_points: 10, ... }`. Assert: `question_points` stayed at the auto-computed value, `bonus_points` = 10.

## Gap 7 — Watcher broadcasts for newer types (P2)

**Status:** `watcher_test.rs::watcher_receives_update_when_score_changes` only tests Standard. Auto-scoring paths (Numeric/Map/MultiAnswer) call `broadcast_scoreboard_data` through the handler, but no test directly asserts the watcher sees the score change for these types.

**Proposed test (one combined):** Set up game with Numeric Q1 and Map Q2, watcher connected, teams submit on both questions with correct locations/answers set — watcher receives a fresh `ScoreboardData` reflecting each scoring event.

---

## Recommended implementation order

| # | What | File | Tests | Est. effort |
|---|------|------|-------|-------------|
| 1 | Map question type | new `map_scoring_test.rs` | ~10 | M |
| 2 | Auto-pause timer | new `auto_pause_test.rs` (or extend `game_timer_test.rs`) | ~5 | S |
| 3 | Navigation × new types | extend `question_navigation_test.rs` | ~3 | S |
| 4 | Reconnection × new types | extend `team_reconnection_test.rs` | ~3 | S |
| 5 | Host reconnect finishes Phase 2 | extend `host_reconnection_test.rs` | 1 | S |
| 6 | Map manual scoring behavior | in `map_scoring_test.rs` | 1 | XS |
| 7 | Watcher × new types | extend `watcher_test.rs` | 1 | XS |

Total: ~24 new tests, mostly mechanical given the existing helper patterns in each file. The biggest lift is Map because we're starting from scratch — but every test maps almost 1:1 to an existing Numeric test, so the structure is reusable.

## Behavior questions worth confirming before writing tests

1. **Map manual scoring** (Gap 6) — when host calls `ScoreAnswer` on a Map question, what *should* happen? Lock in current or change first?
    > This is saying that score_answer will try to match text-identical coordinate submissions and apply equal points? That sounds wrong. We should change the code if that's what it is. Otherwise let's discuss more.
2. **Auto-pause with 0 teams** — start timer with no teams joined: confirm intended behavior is "timer runs normally; auto-pause only triggers via submission".
    > Auto-pause only triggers via submission.
3. **Late-joining team after auto-pause** — does the host need to manually restart the timer for late joiners? (Almost certainly yes, but worth confirming so the test asserts the right thing.)
    > Yes late joiner does need to restart after auto pause

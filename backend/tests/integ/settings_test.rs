use crate::{TestClient, TestServer, default_mc_config};
use backend::model::client_message::{AnswerSubmission, ClientMessage, HostAction, TeamAction};
use backend::model::server_message::ServerMessage;
use backend::model::types::{MapConfig, MultiAnswerConfig, NumericConfig, QuestionKind, ScoreData};

#[tokio::test]
async fn update_game_settings_changes_defaults() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Update game settings
    host.send_json(&ClientMessage::Host(HostAction::UpdateGameSettings {
        default_timer_duration: 60,
        default_question_points: 100,
        default_bonus_increment: 10,
        default_question_type: QuestionKind::MultipleChoice,
        default_mc_config: default_mc_config(),
        speed_bonus_enabled: false,
        speed_bonus_num_teams: 2,
        speed_bonus_first_place_points: 10,
        default_multi_answer_config: MultiAnswerConfig::default(),
        default_numeric_config: NumericConfig::default(),
        default_map_config: MapConfig::default(),
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.game_settings.default_timer_duration, 60);
            assert_eq!(state.game_settings.default_question_points, 100);
            assert_eq!(state.game_settings.default_bonus_increment, 10);
            assert_eq!(
                state.game_settings.default_question_type,
                QuestionKind::MultipleChoice
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn update_game_settings_propagates_to_unanswered_questions() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Create a second question by navigating
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;

    // Update game settings - both Q1 and Q2 are unanswered
    host.send_json(&ClientMessage::Host(HostAction::UpdateGameSettings {
        default_timer_duration: 45,
        default_question_points: 75,
        default_bonus_increment: 15,
        default_question_type: QuestionKind::Standard,
        default_mc_config: default_mc_config(),
        speed_bonus_enabled: false,
        speed_bonus_num_teams: 2,
        speed_bonus_first_place_points: 10,
        default_multi_answer_config: MultiAnswerConfig::default(),
        default_numeric_config: NumericConfig::default(),
        default_map_config: MapConfig::default(),
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            // Both questions should be updated
            assert_eq!(state.questions[0].timer_duration, 45);
            assert_eq!(state.questions[0].question_points, 75);
            assert_eq!(state.questions[0].bonus_increment, 15);

            assert_eq!(state.questions[1].timer_duration, 45);
            assert_eq!(state.questions[1].question_points, 75);
            assert_eq!(state.questions[1].bonus_increment, 15);

            // Timer display should also be updated
            assert_eq!(state.timer_seconds_remaining, Some(45));
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn update_game_settings_does_not_change_answered_questions() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Join a team
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Start timer on Q1 to enable submissions
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Team submits an answer on Q1
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: AnswerSubmission::Single("My answer".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Create Q2 (unanswered)
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Get Q1's original settings
    let q1_original_timer = 30u32; // Default timer duration

    // Update game settings
    host.send_json(&ClientMessage::Host(HostAction::UpdateGameSettings {
        default_timer_duration: 90,
        default_question_points: 200,
        default_bonus_increment: 25,
        default_question_type: QuestionKind::Standard,
        default_mc_config: default_mc_config(),
        speed_bonus_enabled: false,
        speed_bonus_num_teams: 2,
        speed_bonus_first_place_points: 10,
        default_multi_answer_config: MultiAnswerConfig::default(),
        default_numeric_config: NumericConfig::default(),
        default_map_config: MapConfig::default(),
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            // Q1 (has answers) should NOT be updated
            assert_eq!(
                state.questions[0].timer_duration, q1_original_timer,
                "Q1 timer should NOT change because it has answers"
            );

            // Q2 (no answers) SHOULD be updated
            assert_eq!(
                state.questions[1].timer_duration, 90,
                "Q2 timer should be updated to new default"
            );
            assert_eq!(state.questions[1].question_points, 200);
            assert_eq!(state.questions[1].bonus_increment, 25);
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn update_question_settings_changes_specific_question() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Update Q1's settings
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 120,
        question_points: 150,
        bonus_increment: 20,
        question_type: QuestionKind::MultiAnswer,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.questions[0].timer_duration, 120);
            assert_eq!(state.questions[0].question_points, 150);
            assert_eq!(state.questions[0].bonus_increment, 20);

            // Question type should change
            assert_eq!(
                state.questions[0].question_config.kind(),
                QuestionKind::MultiAnswer,
                "Question kind should be MultiAnswer"
            );

            // Timer display should be updated
            assert_eq!(state.timer_seconds_remaining, Some(120));
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn question_type_change_rejected_after_answers() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Join a team
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Start timer to enable submissions
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Team submits an answer
    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: AnswerSubmission::Single("My answer".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Try to change question type (should fail - has answers)
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::MultipleChoice,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("question type"),
                "Error should mention question type, got: {message}"
            );
        }
        other => panic!("Expected Error, got {other:?}"),
    }

    // But changing other settings (same type) should succeed
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 60,
        question_points: 100,
        bonus_increment: 10,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.questions[0].timer_duration, 60);
            assert_eq!(state.questions[0].question_points, 100);
            assert_eq!(state.questions[0].bonus_increment, 10);
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn timer_duration_editable_after_answers_before_scoring() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Start timer, submit answer, then pause
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: AnswerSubmission::Single("My answer".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Timer auto-paused (all teams submitted). Change timer duration should succeed.
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 90,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.questions[0].timer_duration, 90);
            assert_eq!(state.timer_seconds_remaining, Some(90));
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn timer_duration_rejected_while_timer_running() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Start timer (no teams, so it won't auto-pause)
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;

    // Try to change timer duration while running (should fail)
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 90,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("timer"),
                "Error should mention timer, got: {message}"
            );
        }
        other => panic!("Expected Error, got {other:?}"),
    }

    // Pause timer, then change should succeed
    host.send_json(&ClientMessage::Host(HostAction::PauseTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;

    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 90,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.questions[0].timer_duration, 90);
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn question_points_editable_after_answers_before_scoring() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Start timer, submit answer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: AnswerSubmission::Single("My answer".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Change question points (no scoring yet, should succeed)
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 100,
        bonus_increment: 5,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.questions[0].question_points, 100);
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn question_points_rejected_when_answer_scored() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Start timer, submit answer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: AnswerSubmission::Single("My answer".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Score the answer
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "Test Team".to_string(),
        score: ScoreData {
            question_points: 50,
            bonus_points: 0,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Try to change question_points (should fail - has scored answers)
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 100,
        bonus_increment: 5,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("scored"),
                "Error should mention scored answers, got: {message}"
            );
        }
        other => panic!("Expected Error, got {other:?}"),
    }
}

#[tokio::test]
async fn bonus_increment_rejected_when_answer_scored() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Start timer, submit answer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: AnswerSubmission::Single("My answer".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Score the answer
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "Test Team".to_string(),
        score: ScoreData {
            question_points: 50,
            bonus_points: 0,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Try to change bonus_increment (should fail - has scored answers)
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 20,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("scored"),
                "Error should mention scored answers, got: {message}"
            );
        }
        other => panic!("Expected Error, got {other:?}"),
    }
}

#[tokio::test]
async fn speed_bonus_toggle_works_after_scoring() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Start timer, submit answer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: AnswerSubmission::Single("My answer".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Score the answer
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "Test Team".to_string(),
        score: ScoreData {
            question_points: 50,
            bonus_points: 0,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Toggle speed bonus ON (should succeed even with scored answers)
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: true,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert!(state.questions[0].speed_bonus_enabled);
            // Speed bonus should be recalculated - team is correct so gets bonus
            let answer = &state.questions[0].answers[0];
            assert!(
                answer.score.speed_bonus_points > 0,
                "Speed bonus should be recalculated after toggle"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
    let _: ServerMessage = team.recv_json().await;

    // Toggle speed bonus OFF
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert!(!state.questions[0].speed_bonus_enabled);
            let answer = &state.questions[0].answers[0];
            assert_eq!(
                answer.score.speed_bonus_points, 0,
                "Speed bonus should be cleared after toggle off"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn clear_scores_then_change_question_points() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Start timer, submit answer
    host.send_json(&ClientMessage::Host(HostAction::StartTimer))
        .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    team.send_json(&ClientMessage::Team(TeamAction::SubmitAnswer {
        team_name: "Test Team".to_string(),
        answer: AnswerSubmission::Single("My answer".to_string()),
    }))
    .await;
    let _: ServerMessage = team.recv_json().await;
    let _: ServerMessage = host.recv_json().await;

    // Score the answer
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "Test Team".to_string(),
        score: ScoreData {
            question_points: 50,
            bonus_points: 0,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // question_points change should fail (scored)
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 100,
        bonus_increment: 5,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: false,
    }))
    .await;
    let response: ServerMessage = host.recv_json().await;
    assert!(matches!(response, ServerMessage::Error { .. }));

    // Clear the score (mark incorrect)
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "Test Team".to_string(),
        score: ScoreData {
            question_points: 0,
            bonus_points: 0,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;
    let _: ServerMessage = team.recv_json().await;

    // Now question_points change should succeed (no scored answers)
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 1,
        timer_duration: 30,
        question_points: 100,
        bonus_increment: 5,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            assert_eq!(state.questions[0].question_points, 100);
        }
        other => panic!("Expected GameState, got {other:?}"),
    }

    // Re-score with new points
    host.send_json(&ClientMessage::Host(HostAction::ScoreAnswer {
        question_number: 1,
        team_name: "Test Team".to_string(),
        score: ScoreData {
            question_points: 100,
            bonus_points: 0,
            override_points: 0,
            speed_bonus_points: 0,
        },
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            let answer = &state.questions[0].answers[0];
            assert_eq!(answer.score.question_points, 100);
            assert_eq!(
                state.teams[0].score.question_points, 100,
                "Team score should reflect new points"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

#[tokio::test]
async fn update_question_settings_fails_for_nonexistent_question() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Try to update Q99 (doesn't exist)
    host.send_json(&ClientMessage::Host(HostAction::UpdateQuestionSettings {
        question_number: 99,
        timer_duration: 60,
        question_points: 100,
        bonus_increment: 10,
        question_type: QuestionKind::Standard,
        speed_bonus_enabled: false,
    }))
    .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("does not exist"),
                "Error should mention question doesn't exist, got: {message}"
            );
        }
        other => panic!("Expected Error, got {other:?}"),
    }
}

#[tokio::test]
async fn settings_changes_broadcast_to_teams() {
    let server = TestServer::start().await;
    let (mut host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    // Join a team
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;
    let _: ServerMessage = host.recv_json().await;

    // Update game settings
    host.send_json(&ClientMessage::Host(HostAction::UpdateGameSettings {
        default_timer_duration: 45,
        default_question_points: 75,
        default_bonus_increment: 15,
        default_question_type: QuestionKind::Standard,
        default_mc_config: default_mc_config(),
        speed_bonus_enabled: false,
        speed_bonus_num_teams: 2,
        speed_bonus_first_place_points: 10,
        default_multi_answer_config: MultiAnswerConfig::default(),
        default_numeric_config: NumericConfig::default(),
        default_map_config: MapConfig::default(),
    }))
    .await;

    let _: ServerMessage = host.recv_json().await;
    let team_response: ServerMessage = team.recv_json().await;

    match team_response {
        ServerMessage::TeamGameState { .. } => {
            // Team received the broadcast
        }
        other => panic!("Expected TeamGameState, got {other:?}"),
    }
}

#[tokio::test]
async fn new_questions_use_updated_game_settings() {
    let server = TestServer::start().await;
    let (mut host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Update game settings
    host.send_json(&ClientMessage::Host(HostAction::UpdateGameSettings {
        default_timer_duration: 90,
        default_question_points: 200,
        default_bonus_increment: 25,
        default_question_type: QuestionKind::MultipleChoice,
        default_mc_config: default_mc_config(),
        speed_bonus_enabled: false,
        speed_bonus_num_teams: 2,
        speed_bonus_first_place_points: 10,
        default_multi_answer_config: MultiAnswerConfig::default(),
        default_numeric_config: NumericConfig::default(),
        default_map_config: MapConfig::default(),
    }))
    .await;
    let _: ServerMessage = host.recv_json().await;

    // Navigate to create a new question
    host.send_json(&ClientMessage::Host(HostAction::NextQuestion))
        .await;

    let response: ServerMessage = host.recv_json().await;
    match response {
        ServerMessage::GameState { state } => {
            // The new Q2 should use the updated defaults
            assert_eq!(state.questions[1].timer_duration, 90);
            assert_eq!(state.questions[1].question_points, 200);
            assert_eq!(state.questions[1].bonus_increment, 25);

            assert_eq!(
                state.questions[1].question_config.kind(),
                QuestionKind::MultipleChoice,
                "Question kind should be MultipleChoice"
            );
        }
        other => panic!("Expected GameState, got {other:?}"),
    }
}

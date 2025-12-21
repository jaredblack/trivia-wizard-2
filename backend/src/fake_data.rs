use std::collections::HashMap;

use crate::model::server_message::{HostServerMessage, ServerMessage};
use crate::model::types::{
    GameSettings, Question, QuestionData, QuestionKind, ScoreData, TeamColor, TeamData,
    TeamResponse,
};

/// Creates a fake GameCreated message for testing the host view.
/// Generates 5 teams with varied data.
pub fn fake_game_created(game_code: String) -> ServerMessage {
    let game_settings = GameSettings {
        default_timer_duration: 30,
        default_question_points: 50,
        default_bonus_increment: 5,
        default_question_type: QuestionKind::Standard,
    };

    let mut responses: HashMap<String, TeamResponse> = HashMap::new();
    responses.insert(
        "The Geniuses".to_string(),
        TeamResponse {
            answer_text: "Cinnamon brown sugar".to_string(),
            score: ScoreData {
                question_points: 50,
                bonus_points: 0,
                override_points: 0,
            },
        },
    );
    responses.insert(
        "Smink".to_string(),
        TeamResponse {
            answer_text: "Strawberry".to_string(),
            score: ScoreData {
                question_points: 0,
                bonus_points: 0,
                override_points: 0,
            },
        },
    );
    responses.insert(
        "Team Treetops".to_string(),
        TeamResponse {
            answer_text: "P".to_string(),
            score: ScoreData {
                question_points: 50,
                bonus_points: 0,
                override_points: 0,
            },
        },
    );
    responses.insert(
        "We Really Want To Win".to_string(),
        TeamResponse {
            answer_text: "Umm I'm really not sure. Please just give us points Jared!! We deserve so many points pleeeeeaseeeeeeee".to_string(),
            score: ScoreData {
                question_points: 50,
                bonus_points: 0,
                override_points: 0,
            },
        },
    );
    responses.insert(
        "Jason's Former Friends, well, before the incident".to_string(),
        TeamResponse {
            answer_text: "Cinnamon brown sugar".to_string(),
            score: ScoreData {
                question_points: 50,
                bonus_points: 0,
                override_points: 0,
            },
        },
    );

    let current_question = Question {
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_data: QuestionData::Standard { responses },
    };

    let teams = vec![
        TeamData {
            team_name: "The Geniuses".to_string(),
            team_members: vec![
                "Bingo".to_string(),
                "Bango".to_string(),
                "Bongo".to_string(),
            ],
            team_color: TeamColor {
                hex_code: "#DC2626".to_string(), // red
                name: "Red".to_string(),
            },
            score: ScoreData {
                question_points: 3500,
                bonus_points: 20,
                override_points: 0,
            },
            connected: true,
        },
        TeamData {
            team_name: "Smink".to_string(),
            team_members: vec![
                "Smink".to_string(),
                "Smonk".to_string(),
                "Smunk".to_string(),
                "Smank".to_string(),
            ],
            team_color: TeamColor {
                hex_code: "#16A34A".to_string(), // green
                name: "Green".to_string(),
            },
            score: ScoreData {
                question_points: 1850,
                bonus_points: 50,
                override_points: 0,
            },
            connected: true,
        },
        TeamData {
            team_name: "Team Treetops".to_string(),
            team_members: vec![
                "Bob".to_string(),
                "Bilbo".to_string(),
                "Brigid".to_string(),
                "Briella".to_string(),
            ],
            team_color: TeamColor {
                hex_code: "#65A30D".to_string(), // lime
                name: "Lime".to_string(),
            },
            score: ScoreData {
                question_points: 300,
                bonus_points: 50,
                override_points: 0,
            },
            connected: true,
        },
        TeamData {
            team_name: "We Really Want To Win".to_string(),
            team_members: vec!["Sam".to_string(), "Diane".to_string()],
            team_color: TeamColor {
                hex_code: "#EAB308".to_string(), // yellow
                name: "Yellow".to_string(),
            },
            score: ScoreData {
                question_points: 200,
                bonus_points: 0,
                override_points: 0,
            },
            connected: true,
        },
        TeamData {
            team_name: "Jason's Former Friends, well, before the incident".to_string(),
            team_members: vec![
                "Jared".to_string(),
                "Spencer".to_string(),
                "Jacob".to_string(),
                "Blake".to_string(),
                "Austin".to_string(),
                "Riley".to_string(),
                "Jason".to_string(),
            ],
            team_color: TeamColor {
                hex_code: "#F97316".to_string(), // orange
                name: "Orange".to_string(),
            },
            score: ScoreData {
                question_points: 300,
                bonus_points: 50,
                override_points: 0,
            },
            connected: false,
        },
    ];

    ServerMessage::Host(HostServerMessage::GameCreated {
        current_question_number: 16,
        game_code,
        game_settings,
        current_question,
        teams,
    })
}

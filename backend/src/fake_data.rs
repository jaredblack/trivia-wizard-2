// NOTE: This file is currently unused. Games now start empty and use Game::to_game_state().
// Keeping it around for potential future use as test data generator.

#![allow(dead_code)]

use crate::model::server_message::{GameState, ServerMessage};
use crate::model::types::{
    Answer, AnswerContent, GameSettings, Question, QuestionKind, ScoreData, TeamColor, TeamData,
};

/// Creates a fake GameState message for testing the host view.
/// Generates 5 teams with varied data.
pub fn fake_game_state(game_code: String) -> ServerMessage {
    let game_settings = GameSettings {
        default_timer_duration: 30,
        default_question_points: 50,
        default_bonus_increment: 5,
        default_question_type: QuestionKind::Standard,
    };

    // Answers ordered by submission time (first to last)
    let answers = vec![
        Answer {
            team_name: "The Geniuses".to_string(),
            score: Some(ScoreData {
                question_points: 50,
                bonus_points: 0,
                override_points: 0,
            }),
            content: AnswerContent::Standard {
                answer_text: "Cinnamon brown sugar".to_string(),
            },
        },
        Answer {
            team_name: "Smink".to_string(),
            score: Some(ScoreData {
                question_points: 0,
                bonus_points: 0,
                override_points: 0,
            }),
            content: AnswerContent::Standard {
                answer_text: "Strawberry".to_string(),
            },
        },
        Answer {
            team_name: "Team Treetops".to_string(),
            score: Some(ScoreData {
                question_points: 50,
                bonus_points: 0,
                override_points: 0,
            }),
            content: AnswerContent::Standard {
                answer_text: "P".to_string(),
            },
        },
        Answer {
            team_name: "We Really Want To Win".to_string(),
            score: Some(ScoreData {
                question_points: 50,
                bonus_points: 0,
                override_points: 0,
            }),
            content: AnswerContent::Standard {
                answer_text: "Umm I'm really not sure. Please just give us points Jared!! We deserve so many points pleeeeeaseeeeeeee".to_string(),
            },
        },
        Answer {
            team_name: "Jason's Former Friends, well, before the incident".to_string(),
            score: Some(ScoreData {
                question_points: 50,
                bonus_points: 0,
                override_points: 0,
            }),
            content: AnswerContent::Standard {
                answer_text: "Cinnamon brown sugar".to_string(),
            },
        },
    ];

    let current_question = Question {
        timer_duration: 30,
        question_points: 50,
        bonus_increment: 5,
        question_kind: QuestionKind::Standard,
        answers,
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

    ServerMessage::GameState {
        state: GameState {
            game_code,
            current_question_number: 16,
            timer_running: false,
            timer_seconds_remaining: Some(30),
            teams,
            questions: vec![current_question.clone()],
            game_settings,
        },
    }
}

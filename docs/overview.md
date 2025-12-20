# Trivia Wizard 2 Requirements

This document serves as a high-level overview of the Trivia Wizard 2 product, and the general functionality that will be in the final product. After this introduction, functionality will be clearly broken down into individual stories and tasks.

## Overview
Trivia Wizard is a helper application for live in-person trivia events. Trivia Wizard collects answers from teams and sends them to a host view so that the host can score each answer. Trivia Wizard doesn't display or store *question* text, as that is handled by the human who is hosting the trivia event. Trivia Wizard does, however, track information such as team names, their submitted answers, and the scores assigned to each answer.
## Views 
### Home Page
The home page is very simple. It is a menu with three buttons: 
- Start Game: leads to Login Page, so that a host must then log in before they can host a game.
- Join Game: leads to Join Page
- View Game: leads to Scoreboard Page
### Login Page
- This is a standard sign-in page, with options to log in or create an account. There will also be a password reset route. I am not too opinionated on how this works, I just want to keep it simple. If there is a good plug-and-play React solution that plays well with AWS, that sounds great.
- Once the user is successfully logged in, they will be routed to the Host Page.
### Host Page
- This page will start with one button - "Start New Game". This button will initiate a WebSocket connection with the server, with the role Host.
- The server will send back a Game Code. The button will disappear and will be replaced with the Host View.

## Question Types
Question Type is a new concept with Trivia Wizard 2. The Question Type that the host selects for a given question will update both the host's scoring view and the team's input view. Some useful question types:
1. Standard (single answer, free-form)
2. Multi-answer (equivalent to current multi-scoring feature)
    - team view transforms into multiple text inputs (# is configurable per-question by host)
3. Multiple choice
    - team view shows buttons for A-{B..Z} (# is configurable per-question by host)
4. Wagers (not sure what to call this)
    - replicating bar trivia format I've done where you wager 2,4,6 points for each question within a category depending on your confidence. would need to think through the UI for this a bit more
5. Numeric - basically an automation of how I score numeric ones today. 
    - Host can put in the correct answer and how much margin of error teams can have for full points or half points. Or could also have it calculate points more granularly based on how close you are but that would take some math.
# API Descriptions
## Host
### CreateGame
- Input: token?
- Generate a 5 letter word as game code
- Insert a new entry into the game map
- Write a new game to the database
### RejoinGame
- Input: game code, token?
### UpdateGameSettings
### ToggleAllowSubmission
### TimerUpdate
### ScoreAnswer
### UpdateScoreboard
### OverrideScore
### NextQuestion
### UpdateQuestionSettings
## Server-Host
### GameCreated
### PlayerJoined
### PlayerDisconnected
### Success
### AnswerSubmitted
### QuestionInfo
## Server-Team
### JoinedGame
### AllowSubmissionToggled
### TimerUpdate
### Success
### ScoreUpdate
### QuestionInfo
## Team
### JoinGame
### SubmitAnswer



# API Shapes
## Client Messages
### Start Game Request (host join)
- client_type: "host"
- action: "join"
### Join Game Request (team join)
- client_type: "team"
- action: "join"
- team_name: {team_name}
- game_code: {game_code}
## Server Messages
### Start Game Response
- status: "success"
- game_code: {game_code}
### Join Game Response
- status: "success"

We are building the Trivia Wizard app as described in overview.md. We will only implement in small, well-defined stories, which are defined in this document.

## Backend
1. Add tokio_tungstenite and required dependencies to cargo.toml
2. Add tokio_tungstenite example code to main.rs
3. Take the following ClientMessage json shape, and create Rust structs and enums to represent them so they can be serialized and deserialized by serde, and sent by tokio_tungstenite.
{
    "clientType": "host|team",
    "action": "createGame|joinGame|submitAnswer"
    "data": {/* Shape depends on action, see below*/}
}
- createGame:
    - data: {}
- joinGame:
    - data: {"teamName": String, "gameCode": String}
- submitAnswer:
    - data: {"gameCode": String, "teamName": String, "answer": String}
4. In main.rs 



Backlog: 
- Add additional input validation for each message. Ensure that the game code coming in matches the game code that the WS handler has saved
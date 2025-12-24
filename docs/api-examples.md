# Host
(for now)
```json
{
    "host": { 
        "type": "createGame" 
    }
}
```
# Team
## Join game
```json
{
    "team": {
        "joinGame": {
            "teamName": "AS 7",
            "gameCode": "YFJW",
            "colorHex": "0000FF",
            "teamMembers": ["jared"]
        }

    }
}
```
## Submit answer
```json
{
    "team": {
        "submitAnswer": {
            "teamName": "grace",
            "answer": "BingBong"
        }
    }
}
```
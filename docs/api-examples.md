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
            "gameCode": "ABUH",
            "colorHex": "0000FF",
            "colorName": "blue",
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
            "teamName": "AS 7",
            "answer": "BingBong"
        }
    }
}
```
> Blocked on allowing changing some question settings once submissions have started rolling in


Help me design a fourth question type! This fourth question type will be called "Numeric", and the answer will be (you guessed it), numeric. Questions might be such that we are looking for an exact answer, e.g. "How many states are there in the US?" (you only get points if you put exactly 50) or we might be more lenient, e.g. "How many libraries are there in the US?", where we would give full points to a team that got the answer exactly right, and partial points to teams who got it pretty close. So, Numeric will have some settings:

Scoring mode: Exact only, Range, or Closest Guess
If Range:
- Range type: Absolute (+/- N) or Percent (+/- N%)
Range type will define the maximum distance that the team could've guessed from the correct answer while still getting points. If in Absolute mode and N is 5, if the correct answer was 55, the team will get some number of points if they put 50, but even more points if they put 51, all the way up to 55 for full points. Or they could've put 60 and also gotten points. With percent mode, the logic is the same except a user defines N as a percent of the true answer. If the right answer is 5000, N is 10%, the lowest a team could put an answer in and get points for would be 4500 (and highest 5500).

Notice I keep saying "some points", being intentionally vague about how many points teams will get for various answers. I think to start, we just use a linear scoring function to keep things simple.
Answer - 95, points given 0
Answer - 96, points given 10
Answer - 97, points given 20
Answer - 98, points given 30
Answer - 99, points given 40
Answer - 100, points given 50
Answer - 101, points given 40
...and so on.

Nothing stops the users from inputting a decimal value, so
98.5 would get 45 points.

In closest guess mode, the host can define M where M is saying the top M closest teams to the correct answer should get points. These points should be distributed by always halving the number of points the previous team got, so let's walk through an example:
Correct answer: 538, full question points 50 points, M = 3
1st closest team: 500 - 50 points
2nd closest team: 600 - 25 points
3rd closest team: 431 - 12 points
4th closest team: 100 - 0 points

Note: scores must remain whole numbers, anywhere where there would be a decimal point value, we round down (floor).

Numeric is notable because it is also the first question type that requires the host to manually input what the correct answer is instead of the app inferring it by what the host scores correct. In fact, numeric will not have any manual scoring for questionPoints at all - it will all be handled automatically according to what I explained above. 



UI: the user's keyboard should only allow numeric input

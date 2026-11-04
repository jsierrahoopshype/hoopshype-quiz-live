# HoopsHype NBA Quiz Live

An NBA trivia game that runs on the HoopsHype TikTok LIVE. Viewers answer by typing in chat, gifts vote for the next theme and trigger power-ups, and likes unlock blitz rounds. The game runs itself: you start it, go LIVE, and it keeps cycling games.

## What's in here

| File | What it does |
|---|---|
| `START-HOOPSHYPE-QUIZ.bat` | Double-click to run the quiz for real. Opens the quiz window and connects to the TikTok LIVE chat. |
| `PRACTICE-HOOPSHYPE-QUIZ.bat` | Same quiz with fake chat, gifts and likes, so you can watch it without going LIVE. |
| `SET-TIKTOK-ACCOUNT.bat` | Changes which TikTok account the quiz reads (now hoopshype). Run it again if the account changes. |
| `UPDATE-HOOPSHYPE-QUIZ.bat` | Downloads the latest version from GitHub. Keeps your saved scores, recap cards and config.json. |
| `saved/` | Created on first run: champions, weekly board, teams and supporters. Not uploaded to GitHub. |
| `recap-cards/` | Created on first run: a square and a wide PNG after every game, ready for X and Bluesky. Not uploaded to GitHub. |
| `config.json` | TikTok username, the four theme-vote gifts, power-up prices, like goal. |
| `index.html`, `quiz.css`, `quiz.js` | The quiz page itself (1080x1920 portrait). |
| `bridge/quiz-bridge.mjs` | Reads TikTok chat/gifts/likes and passes them to the quiz page. |
| `data/questions.json` | The question bank, built from the public HoopsMatic data repos. |
| `generator/` | Builds the question bank. A GitHub Action reruns it every morning. |

## Question formats

- **Guess the player (letter reveal):** clues and letters appear over time. Also used for birthdays ("born on this day"), hometowns and last night's top scorers.
- **Multiple choice / true or false:** chat types A, B, C or D. Also harder true or false (short stints, numbers just either side of the truth), teammates of both A and B, odd one out, award voting, GM survey, overseas clubs, Vegas standings, arenas and the referee round.
- **Higher or lower:** two players with close numbers, chat types A or B. Also draft combine, head to head (players who debuted in 2016-17 or later), clutch points, buzzer-beaters and streaks.
- **Order it:** three players, chat types the order (e.g. BAC). Exact order scores full points, the right top pick scores 40%.
- **Fill the board** (6 names or fewer), **closest number** (also NBA 2K ratings, one per game at most, and "pick the season"), **chat battles**.
- **Predict tonight:** total points in one of tonight's games. Scored automatically the next time the quiz runs after the final.
- **Speed round:** every 2nd game ends with 5 true-or-false questions, 6 seconds each, points doubling.
- **Survivor:** every 3rd game, one wrong or missed answer and you're out. Survivors get +300 (double if three or fewer).

Timers: 12 seconds at most to pick an answer. Typed answers get 15 seconds or one second per character of the answer, whichever is longer, plus 5 more for "Whose season is this?". Answer screens stay up 3.5 seconds.

The question bank rebuilds every morning (about 5:47am ET) on GitHub, so birthdays, last night's games and the standings are always current.

## Looks

Two looks, same screen layout: **Broadcast** (black and white, HoopsHype red) and **Courtside** (light newsprint). Click the quiz window and press **L** to switch. The pick is saved in `saved/quiz-settings.json` and used by both practice and LIVE.

## Standings

The Top 10 rotates through **Last 15 min**, **Last hour**, **Today** and **This week**. The 15-minute board stays up longest, so a new viewer can climb it within a few minutes. Anyone can type **RANK** in the chat to see their spot on all four boards and how many points they need to move up.

## Coming-back features

- **Trophies:** whoever finishes first on a day or a week gets a 🏆, shown next to their name everywhere with the count (🏆3).

- **Yesterday's champion** shows in the header all day. A day ends at midnight ET. When the champion first chats, the quiz calls them out.
- **This week** board resets every Monday (US Eastern).
- **Team battle:** viewers type their team once (LAL, BOS, Lakers, Boston...). Every point they score also counts for their team on the weekly team board. A bare team name only joins if you have no team yet; to switch, type "team bos" or "join celtics".
- **Recap cards** after every game: winner, podium and the hardest question, in `recap-cards/`.
- **Auto-easing:** if nobody gets 3 questions in a row, the rest of that game switches to easy questions.

## Money mechanics

- Four theme tiles, each tied to a gift (Rose, Ice Cream Cone, GG, Finger Heart by default). Every coin is one vote for the next theme.
- Any other gift of 30+ coins drops a hint for everyone, 99+ coins makes the next question double points, 199+ coins starts a blitz round.
- Every gift also adds 10 points per coin to the sender's score and puts them on Top supporters.
- Like goal: hitting it starts a blitz round. Follow +25 points, share +50.
- Nothing is a prize or a paid chance to win anything, which keeps it clear of TikTok's gambling rules.

## Operator keys (click the quiz window first)

N = skip question · P = pause/resume · B = blitz round now · M = sound on/off · L = next look · R = reset stream scores

## Data sources

All public HoopsMatic repos: salary-season-finder (stats, bios, awards, salaries), nba-milestones (live career leaderboards), nba-stat-streaks (triple-doubles, 50-point games), nba-jersey-sales, nba-headshots (face-fill-320 photos). The rumors archive is not used.

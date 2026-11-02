# HoopsHype NBA Quiz Live

An NBA trivia game that runs on the HoopsHype TikTok LIVE. Viewers answer by typing in chat, gifts vote for the next theme and trigger power-ups, and likes unlock blitz rounds. The game runs itself: you start it, go LIVE, and it keeps cycling games.

## What's in here

| File | What it does |
|---|---|
| `START-HOOPSHYPE-QUIZ.bat` | Double-click to run the quiz for real. Opens the quiz window and connects to the TikTok LIVE chat. |
| `PRACTICE-HOOPSHYPE-QUIZ.bat` | Same quiz with fake chat, gifts and likes, so you can watch it without going LIVE. |
| `UPDATE-HOOPSHYPE-QUIZ.bat` | Downloads the latest version from GitHub. Keeps your saved scores, recap cards and config.json. |
| `saved/` | Created on first run: champions, weekly board, teams and supporters. Not uploaded to GitHub. |
| `recap-cards/` | Created on first run: a square and a wide PNG after every game, ready for X and Bluesky. Not uploaded to GitHub. |
| `config.json` | TikTok username, the four theme-vote gifts, power-up prices, like goal. |
| `index.html`, `quiz.css`, `quiz.js` | The quiz page itself (1080x1920 portrait). |
| `bridge/quiz-bridge.mjs` | Reads TikTok chat/gifts/likes and passes them to the quiz page. |
| `data/questions.json` | The question bank, built from the public HoopsMatic data repos. |
| `generator/` | Builds the question bank. A GitHub Action reruns it every Monday. |

## Question formats

- **Guess the player (letter reveal):** clues and letters appear over time, first correct name scores most.
- **Multiple choice:** chat types A, B, C or D. First answer per person counts.
- **True or false.**
- **Higher or lower:** two players, chat types A or B.
- **Fill the board:** "Name the top 10 all-time scorers", chat fills the slots.
- **Closest number wins:** career totals, salaries, draft years.
- **Chat battles:** opinion votes, everyone on the winning side scores.

Themes: Career Paths, Stat Lines, Draft & Bio, Awards & Rings, Record Book, Money Talks, Jersey Kings, Around the World, Name the Face, Franchise Legends, plus Mixed.

## Coming-back features

- **Last night's champion** shows in the header all night. A "night" is a US Eastern date that rolls over at 6am ET. When the champion first chats, the quiz calls them out.
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

N = skip question · P = pause/resume · B = blitz round now · M = sound on/off · R = reset stream scores

## Data sources

All public HoopsMatic repos: salary-season-finder (stats, bios, awards, salaries), nba-milestones (live career leaderboards), nba-stat-streaks (triple-doubles, 50-point games), nba-jersey-sales, nba-headshots (face-fill-320 photos). The rumors archive is not used.

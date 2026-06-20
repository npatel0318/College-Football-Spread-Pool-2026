# College Football Spread Pool

A spread pool app for you and your friends: the commissioner sets each week's
games and spreads, everyone picks a side, and standings track who's covered
the most.

This version runs on Firebase (free) for shared data and GitHub Pages (free)
for hosting — no Claude subscription needed for anyone, including you.

## One-time setup

You'll do four things, in order: create a Firebase project, configure this
project to use it, push to GitHub, and turn on GitHub Pages.

### 1. Create a Firebase project (free, no card required)

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   and sign in with any Google account.
2. Click **Add project**, give it any name (e.g. "cfb-spread-pool"), and
   finish the wizard (you can decline Google Analytics, it's not needed).
3. Once the project opens, click **Build > Firestore Database** in the left
   sidebar, then **Create database**. Choose any region close to you, and
   start in **test mode** (we'll lock it down with real rules in step 4 below
   — test mode just gets you unblocked immediately).
4. Click the gear icon next to **Project Overview** > **Project settings**.
   Scroll to **Your apps**, click the **</>** (web) icon, give the app any
   nickname, and skip Firebase Hosting (you're using GitHub Pages instead).
5. Firebase will show you a `firebaseConfig` object. Copy it.

### 2. Configure this project

1. Open `src/firebase.js` and replace the placeholder values with the real
   `firebaseConfig` object you just copied. These values are safe to commit —
   they're not secrets (more on that in the comment in that file).
2. Open the Firestore rules: in the Firebase console, go to **Firestore
   Database > Rules**, delete what's there, and paste in the contents of
   `firestore.rules` from this project. Click **Publish**. This restricts
   reads/writes to just the three collections this app uses.
3. Open `vite.config.js` and change `base` from
   `"/REPLACE-WITH-YOUR-REPO-NAME/"` to `"/your-actual-repo-name/"` — it must
   exactly match whatever you name the GitHub repo in the next step,
   including the slashes.

### 3. Push to GitHub

1. Create a new repository on GitHub (public or private both work).
2. From this project folder:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
   git push -u origin main
   ```

### 4. Turn on GitHub Pages

1. On GitHub, go to your repo's **Settings > Pages**.
2. Under **Build and deployment > Source**, choose **GitHub Actions** (not
   "Deploy from a branch" — this project already includes the right workflow
   file at `.github/workflows/deploy.yml`).
3. That's it — pushing to `main` automatically builds and deploys. Check the
   **Actions** tab on GitHub to watch it run (takes about a minute). Once it
   finishes, your app is live at `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`.

Send that link to your pool. The first person to open it should run through
the "create the pool" setup screen (league name, their name, a commissioner
passcode) before anyone else joins.

## Making changes later, with Claude

You don't need Claude Code or any paid plan for this. The flow:

1. Open a chat with Claude (claude.ai, any plan) and describe the feature you
   want, or paste in the relevant file's contents and ask for changes.
2. Claude gives you the updated file.
3. On GitHub.com, navigate to that file in your repo, click the pencil
   (edit) icon, paste in the new version, and click **Commit changes**.
4. The Actions workflow rebuilds and redeploys automatically — refresh the
   live site in a minute or two and the change is there.

If you'd rather work locally: `npm install` once, then `npm run dev` to test
changes on your own machine before committing, or `npm run build` to confirm
it compiles cleanly.

## How the data is organized

Firestore has three collections, mirroring how the app used to store data:

- `leagueMeta` — one document (`current`) with the league name, member list,
  commissioner passcode, and the list of weeks that exist.
- `weeks` — one document per week number, holding that week's games, spreads,
  lock status, and (once entered) final scores.
- `picks` — one document per `{week, person}` pair, holding that person's
  picks for that week.

"Personal" data — your name on this device, and the commissioner's saved
CFBD/Odds API keys — lives in this browser's `localStorage` instead of
Firestore, so it never leaves your device and never shows up in the shared
database.

## A note on security

There's no login system here, by design — it's just a name picker and a
commissioner passcode, the same lightweight trust model as the original. The
Firestore rules restrict access to this app's three collections, but don't
verify *who* is writing, only *what* they're allowed to touch. That's fine
for a private link shared with friends; don't use this pattern for anything
that needs real access control.

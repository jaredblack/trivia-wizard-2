# 1. Main Page (Unauthenticated)
This is the main page of the app, which should load if the user is unauthenticated. It is very simple. It should consist of the following:
1. A large, centered, bolded text saying "Trivia Wizard".
2. Centered below the text, a single blue button, reading "Get started". Clicking on this button takes the user to the Authenticator view.
# 2. Host Landing
This is route /hostlanding. It should consist of:
1. a header row at the top of the page, with "Hello, {username}" at the top left, and a "Sign out" button at the top right.
2. Centered both vertically and horizontally in the page the page, there should be a status indicator, which will just be a line of text with a dot to the left of it. The status indicator has two states:
    1. "Trivia server idle" - in this state, the left dot will be gray.
    2. "Trivia server running" - in this state, the left dot will be green.
3. Just below the status indicator will be a button, which reads one of the following:
    1. "Start trivia server" IF the status indicator is in the idle state.
    2. "Stop trivia server" IF the status indicator is in the running state.
4. Since we are just writing the UI right now, this button will simply toggle the status indicator directly. There will be no actual starting and stopping of a server.
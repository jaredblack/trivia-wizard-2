Host perspective:
Settings:
- Response type
    - Letter
    - Number
    - Yes/No
    - True/False
    - Other (host freeform)
- num options
    - hardcoded at 2 for yes/no, true/false

Team perspective:
When submissions are open, they see big boxes with options and a submit button at the bottom

Will not implement the "Other" response type to start

Previous thinking for the model was to just have multiple choice have a Vec<String> representing the options
But we could have it be a bit richer storing the response type, the options, and the number of responses, that way the frontend doesn't need to infer which response type it was

Advanced: could also have an option for "select all that apply"
but TBH I don't think I've ever done a question like that to this point
could add it if I ever want it. Scoring gets a bit tricky with that

This is a trivia app. The two types of users are hosts and teams. Hosts administer the game, ask the questions (outside of the app), score the questions, and teams submit answers on their mobile devices.

I have built the concept of "Question Type" into the app, though there is at present only one question type. Question type essentially defines how the teams will be able to answer the question. The currently implemented question type is "Standard", where the team has a text box where they can simply input their answer, and the host receives that text and is able to score it. As my second question type, I would like to implement Multiple Choice.

A host will have 2 or 3 controls with a single multiple choice question:
    1. Option type - this is the actual content of the multiple choice options. This would be selected in a dropdown menu by the host for a given question. The options are:
        a. Letters (default) - A, B, C, D...
        b. Number - 1, 2, 3, 4...
        c. Yes/No
        d. True/False
        e. Other - options defined by host
    2. Number of options (default 4). This is how many options exist. For example, if the host leaves the defaults, the options will be A, B, C, D. If they change to 5 options, E will also be an option. Yes/No and True/False will be hardcoded at 2 options, naturally.
    3. This is the optional setting for when the option type is Other. The host will be able to input custom options for the multiple choice. 

I have attached an image of what the host view would look like for multiple choice. The key difference between what we already have and multiple choice is that in multiple choice, we have an additional toolbar to adjust the controls I just described, which will sit at the top of the submitted answer list.

The UI adjustments here will need to made in HostGame.tsx around line 189 to add the controls above the answer list when the question type is multiple choice. Note that this will not be the last question type implemented, and that future question types may even change the AnswerList UI. For this reason, we should probably put what's currently in the "Main content area" in a StandardMainArea component (with just an answer list), and a MultipleChoiceMainArea (which has the multiple choice controls bar, and also an answer list). That way, we can easily swap in new main area components for new question types.

Please note, the "Edit Options" button will only be present for Option type is Other, and in the initial implementation, we will show that button when the option type is Other, but we won't update any functionality yet that allows the host to edit the options. For now we can just force the options to be the same as Letters when Other is selected.

There will be no difference in how the answers are seen or scored by the host between standard and multiple choice question types.

Next, let's look at the team UI. Here, we're looking at about line 104 in TeamGameView.tsx. Similarly, we will want to create separate components for each question type. Only the question input needs to change for different question types, so Views A and C can remain the same. The second screenshot shows what this input would look like for different option types and numbers of responses. Two buttons will always show in a row of fixed width and height. When options are selected, they will change to be the team's color. Teams can select and change between different options, they don't actually submit until Submit Answer is pressed or the timer runs out (same as the current behavior for Standard questions).

The notion of QuestionType was considered with the original design so some of the code is already in place, but it is inconsistent.

Please use my screenshots, my prompt, and searching through the frontend and backend code to get a sense of what will need to be done to accomplish what I've described. Then, ask me clarifying questions to make sure that we are on the same page. After that, create a plan for how we will implement this second question type.
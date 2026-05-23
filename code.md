# Code Notes

This file summarizes the important concepts we discussed in the codebase and groups them by area.

## Backend

### `Field` in `backend/classes.py`

`Field` is imported from Pydantic:

```python
from pydantic import BaseModel, Field
```

It is used in `PromptResponse` like this:

```python
conversation_history: list = Field(default_factory=list)
```

This means:

- `conversation_history` should be a list
- if no value is provided, Pydantic creates a new empty list
- each model instance gets its own fresh list

This is important because `conversation_history` is mutable. If a mutable default is handled incorrectly, old data can leak across instances and create hard-to-debug shared state issues.

### Why not just use `conversation_history = []`

Using:

```python
conversation_history: list = []
```

can be risky because lists are mutable.

The main idea is:

- `=[]` means "use this list as the default"
- `Field(default_factory=list)` means "create a brand new list every time"

Why this matters for the backend:

- conversation history belongs to one request or one response flow
- it should not accidentally reuse data from another model instance
- using `Field(default_factory=list)` makes the default behavior safe and predictable

### Why `conversation_history` matters for backend logic

The backend uses conversation history to preserve chat context.

In `backend/extractor.py`, `user_response_stream(...)` accepts:

```python
conversation_history: list | None = None
```

If history exists, it is added into `chat_messages` before the latest user prompt. This helps the model continue the conversation naturally instead of treating every new message like a brand new chat.

So the backend relevance is:

- it stores prior user/assistant messages
- it helps maintain continuity
- it improves follow-up answers by giving the model context

## Frontend

### Named imports vs default imports in `ChatSection.jsx`

In `frontend/src/ChatSection/ChatSection.jsx`, these two imports use different syntax:

```js
import { getAvailableVariants } from '../utils/variantRules.js';
import MetadataDropdown from './MetadataDropdown';
```

The difference comes from how each file exports its value.

`variantRules.js` uses a named export:

```js
export const getAvailableVariants = ...
```

That must be imported with curly braces:

```js
import { getAvailableVariants } from '../utils/variantRules.js';
```

`MetadataDropdown.jsx` uses a default export:

```js
export default MetadataDropdown;
```

That is imported without curly braces:

```js
import MetadataDropdown from './MetadataDropdown';
```

Quick rule:

- named export -> use curly braces
- default export -> no curly braces

### `conversationHistory` in `ChatSection.jsx`

Inside `handleSubmit`, the component builds a structured recent-history array from `messages`:

```js
const conversationHistory = messages
    .slice(-MAX_SESSION_MEMORY_MESSAGES)
    .map((message) => ({
        role: message.sender === 'user' ? 'user' : 'assistant',
        content: message.title,
    }));
```

### What it does

It converts the visible chat transcript into the structured role/content format expected by the backend and OpenAI chat flow.

Example output:

```js
[
  { role: 'user', content: 'How do I solve this?' },
  { role: 'assistant', content: 'Start by factoring the expression.' }
]
```

### Why it is used

It gives the backend short-term session memory for follow-up questions.

That matters because:

- the user may ask clarifying questions
- the model should remember its earlier explanation
- the app wants continuity without storing conversations in a database

### Where it is used

The second API call sends:

```js
body: JSON.stringify({
    data_formatted: formatted_data.past_paper_data,
    user_prompt: responsePrompt,
    conversation_history: conversationHistory
})
```

So `conversationHistory` is the real conversation-memory payload.

### Important design update

The frontend no longer uses `formatConversationHistory(...)` and no longer embeds a duplicate transcript inside `responsePrompt`.

That older design sent history in two forms:

1. as structured JSON in `conversation_history`
2. as plain-text transcript inside `responsePrompt`

The current design is cleaner:

1. prior chat turns are sent once as structured `conversation_history`
2. `responsePrompt` focuses on the current request and, when metadata exists, explicitly ties that request to the dropdown-selected paper

This change was made because the duplicate transcript fallback was over-emphasizing generic earlier chat like `Hello`, which could weaken prompt grounding for later paper-specific questions.

## API Flow

### First API call: why `backendPrompt` is sent

In `ChatSection.jsx`, the first API call sends:

```js
body: JSON.stringify({ user_prompt: backendPrompt, metadata: metadataString })
```

`backendPrompt` is built from:

- the dropdown metadata
- the current user message

Example idea:

```js
backendPrompt = metadataString.join(", ") + ". " + currentPrompt;
```

However, in the current backend implementation, `/get_info` does not actually use `user_prompt`.

In `Backend/main.py`:

```python
@app.post("/get_info")
def get_info(data: PromptRequest):
    extracted_info = information_extraction(data.metadata)
```

And in `backend/extractor.py`:

```python
def information_extraction(metadata: list):
```

So right now:

- `/get_info` is driven by `metadata`
- `user_prompt` is accepted by the schema but ignored in practice
- sending `backendPrompt` instead of `currentPrompt` makes no difference for the current logic

This suggests `backendPrompt` is likely left over from an earlier or future design where the backend might extract metadata from natural language.

### Second API call: why conversation history is sent

The second API call is different because it actually needs conversational context for the tutoring response.

It sends:

- `data_formatted`
- `user_prompt`
- `conversation_history`

Here, the prompt content matters because the OpenAI model is generating the explanation. Unlike `/get_info`, this route does use the prompt meaningfully.

### `responsePrompt` in the current design

The current frontend builds `responsePrompt` like this:

```js
const responsePrompt = metadataString.length > 0
    ? `The user has selected a specific past paper question using the metadata dropdowns: ${metadataString.join(", ")}. Use the retrieved question paper and mark scheme already provided to answer the user's request about that selected question.\n\nLatest user request: ${currentPrompt}`
    : currentPrompt;
```

This means:

- if metadata is selected, the prompt explicitly tells the model that the paper/question has already been identified
- the model is told to use the already retrieved question paper and mark scheme
- the latest user message is still preserved

This is an important improvement over the older prompt shape, where the model could see the paper data in the system prompt but still interpret the user-side request as too generic, especially after a greeting-only first turn.

### Why this helps with the earlier bug

Previously, a sequence like:

- `Hello`
- assistant greeting
- `Can you please help me with this question`

could cause the model to respond generically even when `past_paper_data` was present, because the user prompt did not strongly connect "this question" to the retrieved paper.

The new `responsePrompt` reduces that ambiguity by explicitly stating that:

- the dropdown metadata identifies the target paper
- the retrieved paper and mark scheme should be used now
- the current request is about that selected question

## State And Fallbacks

### Why cached `paperData` exists

This block appears after the first API call:

```js
if ((formatted_data.past_paper_data[0] === '') && (formatted_data.past_paper_data[1] === '') && (paperData.length !== 0)) {
    formatted_data = paperData;
    console.log("Using cached paper data");
}
```

Its purpose is to keep using the last successfully retrieved question paper and mark scheme if the current lookup returns empty data.

The intended behavior is:

- if the current fetch does not find a new paper
- but the app already has previous paper data stored
- reuse the old paper data so the conversation can continue

### Is that cache necessary if dropdown state already persists?

Usually, if a user asks a follow-up question and does not change the dropdowns, the same metadata is still in state and the same paper can simply be fetched again.

That means:

- in the normal path, the cache is not essential
- the dropdown state already preserves the metadata
- follow-up questions should still work without the cache as long as the fetch succeeds

So the cache is better understood as a fallback safety net, not the main continuity mechanism.

### When the cache helps

The cache may still help in edge cases such as:

- incomplete metadata being sent accidentally
- temporary lookup failure
- a fetch returning empty unexpectedly

In those cases, the app avoids losing the previous paper context immediately.

### Is it safe to remove?

It is probably safe to remove if the goal is to simplify the code and you are comfortable losing that fallback behavior.

Removing it would mean:

- normal follow-up flows should still work if the dropdowns remain filled
- the app would no longer recover automatically from an empty paper-data fetch by reusing the old paper

So removing it simplifies the logic, but also removes a small resilience feature.

## Authentication UI

### High-level goal of the auth work

The current authentication work is **UI-only**.

That means:

- there is no real login/signup request yet
- there is no Supabase auth call yet
- there is no token/session storage yet
- there is no protected route logic yet

Instead, the purpose of this implementation is to:

- give unauthenticated users visible `Sign Up` and `Log In` entry points
- open the correct auth form when a user clicks one of those buttons
- keep the auth logic isolated from the main chat logic as much as possible
- prepare a clean structure for future real authentication

### How the auth UI is integrated into `ChatSection.jsx`

The integration in `frontend/src/ChatSection/ChatSection.jsx` is intentionally small.

The main auth-related imports are:

```js
import AuthActions from '../Auth/AuthActions';
import AuthOverlay from '../Auth/AuthOverlay';
```

This tells us that `ChatSection.jsx` does **not** implement the forms itself.
It only:

- renders the top-right auth entry buttons
- decides whether the auth modal is open
- decides whether the modal should show `signup` or `login`

### Auth state added to `ChatSection.jsx`

Two small pieces of React state were added:

```js
const [isAuthOverlayOpen, setIsAuthOverlayOpen] = useState(false);
const [authMode, setAuthMode] = useState('signup');
```

#### What each one means

`isAuthOverlayOpen`

- `false` means the auth modal is hidden
- `true` means the auth modal is visible

`authMode`

- stores which form the user wanted to open
- possible current values are:
  - `'signup'`
  - `'login'`

This is useful because the user does not toggle between forms *inside* the modal anymore.
Instead, the entry button they clicked determines which form opens.

### Open and close handlers in `ChatSection.jsx`

The component defines:

```js
const handleOpenAuth = (mode) => {
    setAuthMode(mode);
    setIsAuthOverlayOpen(true);
};

const handleCloseAuth = () => {
    setIsAuthOverlayOpen(false);
};
```

#### Why this is a good pattern

This keeps the state transition simple:

1. when a user clicks `Sign Up` or `Log In`, `handleOpenAuth(...)` is called
2. that function stores the intended mode
3. then it opens the modal

So:

- `handleOpenAuth('signup')` means "show the sign-up form"
- `handleOpenAuth('login')` means "show the login form"

`handleCloseAuth()` only closes the modal.
It does not reset the entire chat or affect chatbot state.

### Where the auth buttons are rendered

In the top bar of `ChatSection.jsx`, the auth actions are mounted like this:

```js
<AuthActions
    onOpenSignUp={() => handleOpenAuth('signup')}
    onOpenLogIn={() => handleOpenAuth('login')}
/>
```

This is a classic parent-to-child callback pattern in React.

#### What is happening here

`ChatSection.jsx` owns the state.

`AuthActions.jsx` does **not** know how to open the modal by itself.
Instead, `ChatSection.jsx` gives it two functions:

- `onOpenSignUp`
- `onOpenLogIn`

When one of the buttons is clicked inside `AuthActions.jsx`, that child component simply calls the function it received from the parent.

This is important because it keeps responsibility clean:

- `ChatSection.jsx` owns the auth open/close state
- `AuthActions.jsx` is just a presentational trigger component

### What `AuthActions.jsx` does

`frontend/src/Auth/AuthActions.jsx` is intentionally very small:

```js
function AuthActions({ onOpenSignUp, onOpenLogIn }) {
    return (
        <div className={styles.Actions} aria-label="Authentication actions">
            <button type="button" className={styles.SecondaryButton} onClick={onOpenLogIn}>
                Log In
            </button>
            <button type="button" className={styles.PrimaryButton} onClick={onOpenSignUp}>
                Sign Up
            </button>
        </div>
    );
}
```

#### JavaScript role of this component

Its job is only to:

- receive callbacks as props
- attach those callbacks to button clicks

It does **not**:

- store form data
- decide which auth mode is active
- decide whether the overlay is open

That logic stays above it in `ChatSection.jsx`.

### Where the auth modal is rendered

At the bottom of `ChatSection.jsx`, the overlay is mounted like this:

```js
<AuthOverlay
    isOpen={isAuthOverlayOpen}
    mode={authMode}
    onClose={handleCloseAuth}
/>
```

This means `ChatSection.jsx` passes three things down:

- whether the modal is open
- which form should be shown
- how to close it

Again, the state is owned by the parent and the child becomes predictable.

### What `AuthOverlay.jsx` does

`frontend/src/Auth/AuthOverlay.jsx` is the component that decides whether anything should render at all.

Its most important early guard is:

```js
if (!isOpen) {
    return null;
}
```

#### Why `return null` matters

In React, returning `null` means:

- render nothing
- do not show the modal in the DOM

So the overlay exists only when needed.
This is cleaner than always rendering it and hiding it purely with CSS.

### How `AuthOverlay.jsx` decides which form to show

Inside the component:

```js
const isSignUp = mode === 'signup';
```

Then later:

```js
{isSignUp ? <SignUpForm /> : <LoginForm />}
```

This is the key branching logic for the auth UI.

#### Why this pattern is useful

It gives one overlay shell two different behaviors:

- if the mode is `'signup'`, render the sign-up form
- otherwise render the login form

That means:

- only one modal container is needed
- the form content can change without duplicating overlay logic

### Close behavior inside `AuthOverlay.jsx`

The close behavior is handled in three ways.

#### 1. Backdrop click

```js
<button type="button" className={styles.Backdrop} onClick={onClose} />
```

Clicking outside the form panel calls the parent close handler.

#### 2. Top-right close button

```js
<button type="button" className={styles.CloseButton} onClick={onClose}>
    x
</button>
```

This gives the user an explicit manual close control.

#### 3. Escape key

`AuthOverlay.jsx` uses `useEffect` to register and clean up a keyboard listener:

```js
useEffect(() => {
    if (!isOpen) {
        return undefined;
    }

    const handleEscape = (event) => {
        if (event.key === 'Escape') {
            onClose();
        }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
        document.removeEventListener('keydown', handleEscape);
    };
}, [isOpen, onClose]);
```

#### Why this effect is important

It does three things well:

1. it only adds the listener when the modal is open
2. it closes the modal on `Escape`
3. it removes the listener when the modal closes or the component unmounts

That cleanup matters because otherwise keyboard listeners can accumulate and create bugs.

### Why the auth forms were split into separate files

The main auth forms live in:

- `frontend/src/Auth/SignUpForm.jsx`
- `frontend/src/Auth/LoginForm.jsx`

This was done to keep `ChatSection.jsx` small and stable.

If the form JSX and form state had been placed directly inside `ChatSection.jsx`, that file would start mixing:

- chat logic
- streaming logic
- metadata logic
- auth form logic

That would make future maintenance harder.

### How `SignUpForm.jsx` works

The sign-up form stores all its values in one object:

```js
const [formValues, setFormValues] = useState({
    name: '',
    email: '',
    password: '',
    grade: ''
});
```

#### Why one object is used

This groups all sign-up inputs into one piece of state.

Benefits:

- related values stay together
- updates follow a consistent pattern
- future submission logic becomes easier to build

### Reusable field update pattern in `SignUpForm.jsx`

The form uses a higher-order function:

```js
const handleChange = (field) => (event) => {
    setFormValues((prev) => ({
        ...prev,
        [field]: event.target.value
    }));
};
```

#### What this means

`handleChange('name')` returns a function that updates only `name`.

`handleChange('email')` returns a function that updates only `email`.

`handleChange('password')` returns a function that updates only `password`.

So each input can reuse the same update logic:

```js
onChange={handleChange('name')}
```

instead of writing three separate handlers like:

- `handleNameChange`
- `handleEmailChange`
- `handlePasswordChange`

This is a clean React pattern when multiple fields share the same update structure.

### Grade handling in `SignUpForm.jsx`

The grade field is different because it comes from a custom component, not a plain `<input>`.

That is why there is a separate handler:

```js
const handleGradeChange = (selectedGrade) => {
    setFormValues((prev) => ({
        ...prev,
        grade: selectedGrade
    }));
};
```

Then it is passed into:

```js
<GradeSelect value={formValues.grade} onChange={handleGradeChange} />
```

So the parent form still owns the actual selected value, while `GradeSelect` only manages the dropdown UI behavior.

### Why the sign-up form submit currently does nothing

Right now:

```js
const handleSubmit = (event) => {
    event.preventDefault();
};
```

This means:

- the browser does not perform a full page reload
- no network request is sent yet

This is intentional.
The UI was built first, while real auth behavior is deferred for later.

In the future, this is the exact place where real logic would likely be inserted:

- input validation
- Supabase sign-up call
- profile creation
- error handling
- loading state

### How `LoginForm.jsx` works

`LoginForm.jsx` follows the same pattern as `SignUpForm.jsx`, but with a smaller state object:

```js
const [formValues, setFormValues] = useState({
    email: '',
    password: ''
});
```

It reuses the same general ideas:

- local form state
- one reusable `handleChange(field)` pattern
- `event.preventDefault()` in `handleSubmit`

So the JavaScript behavior is consistent between both auth forms.

### How `GradeSelect.jsx` works

`GradeSelect.jsx` is the most interactive auth-specific component.

It uses:

```js
const [isOpen, setIsOpen] = useState(false);
const containerRef = useRef(null);
```

#### Why both are needed

`isOpen`

- tracks whether the dropdown menu is visible

`containerRef`

- points to the root DOM element of the grade selector
- helps detect clicks outside the component

### Option data in `GradeSelect.jsx`

The grade options are hardcoded:

```js
const options = [
    { value: 'IGCSE', label: 'IGCSE' },
    { value: 'A-levels', label: 'A-levels' }
];
```

This makes the component simple and predictable for now.

### Click-outside and Escape handling in `GradeSelect.jsx`

The component uses `useEffect` to add two document-level listeners:

```js
useEffect(() => {
    const handlePointerDown = (event) => {
        if (containerRef.current && !containerRef.current.contains(event.target)) {
            setIsOpen(false);
        }
    };

    const handleEscape = (event) => {
        if (event.key === 'Escape') {
            setIsOpen(false);
        }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
        document.removeEventListener('mousedown', handlePointerDown);
        document.removeEventListener('keydown', handleEscape);
    };
}, []);
```

#### Why this logic exists

It makes the custom dropdown behave more like a native UI control:

- clicking outside closes it
- pressing `Escape` closes it

Without this logic, the dropdown could stay open in awkward ways.

### How an option is selected in `GradeSelect.jsx`

The main selection handler is:

```js
const handleSelect = (selectedValue) => {
    onChange(selectedValue);
    setIsOpen(false);
};
```

This is another parent-child data-flow pattern:

- `GradeSelect` does not own the selected grade permanently
- it reports the chosen value upward through `onChange`
- the parent form stores that value in `formValues.grade`

This is important because it keeps the real form data centralized in `SignUpForm.jsx`.

### Relationship between the auth components

The JavaScript responsibilities can be summarized like this:

`ChatSection.jsx`

- owns auth open/close state
- owns which auth mode should open
- passes callbacks into auth entry buttons
- passes state into the auth overlay

`AuthActions.jsx`

- triggers open requests

`AuthOverlay.jsx`

- decides whether to render
- decides which form to render
- handles close interactions

`SignUpForm.jsx`

- owns sign-up input state
- owns sign-up submit placeholder logic

`LoginForm.jsx`

- owns login input state
- owns login submit placeholder logic

`GradeSelect.jsx`

- owns dropdown open/close UI state
- reports the selected grade upward

### Why this architecture is useful for future real auth

This structure was chosen so that future auth logic can be added without rewriting the whole chat component.

For example:

- `ChatSection.jsx` probably will not need major changes when real auth is added
- `SignUpForm.jsx` can later call Supabase sign-up
- `LoginForm.jsx` can later call Supabase login
- `AuthOverlay.jsx` can later display loading/error states
- `AuthActions.jsx` can later be swapped out for account/profile controls after login

So the main benefit is separation of concerns:

- chat logic stays in the chat area
- auth logic stays in the auth components
- state ownership stays reasonably clear

### Very brief note on HTML and CSS

The HTML side is intentionally simple:

- buttons for entry actions
- a modal wrapper and backdrop
- controlled inputs for form fields
- a custom button-based grade dropdown

The CSS mainly handles:

- modal positioning
- spacing
- dark-theme styling
- responsive sizing
- internal scroll fallback for smaller viewports

The important architectural part is still the JavaScript data flow and component boundaries, not the markup itself.

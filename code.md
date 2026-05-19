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

### `formatConversationHistory` in `ChatSection.jsx`

The function:

```js
const formatConversationHistory = (conversationHistory) => {
    if (conversationHistory.length === 0) {
        return "";
    }

    return conversationHistory
        .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
        .join('\n');
};
```

### What it does

It converts an array of message objects into one plain-text transcript.

Example input:

```js
[
  { role: 'user', content: 'How do I solve this?' },
  { role: 'assistant', content: 'Start by factoring the expression.' }
]
```

Example output:

```text
User: How do I solve this?
Assistant: Start by factoring the expression.
```

### Why it is used

It helps package recent chat history into a readable prompt string for the chatbot request.

That matters because follow-up questions often depend on what was already said earlier in the conversation.

### Where it is used

Inside `handleSubmit`, the component first builds a structured history array from `messages`:

```js
const conversationHistory = messages
    .slice(-MAX_SESSION_MEMORY_MESSAGES)
    .map((message) => ({
        role: message.sender === 'user' ? 'user' : 'assistant',
        content: message.title,
    }));
```

Then it formats that array:

```js
const formattedConversationHistory = formatConversationHistory(conversationHistory);
```

Then it uses the result to build `responsePrompt`.

If history exists, the prompt includes:

- a note that this is a continuing conversation
- the earlier conversation history
- the latest user message

If history does not exist, it just uses the current prompt.

### Important design note

The frontend sends conversation context in two forms:

1. as formatted plain text inside `responsePrompt`
2. as structured JSON in `conversation_history`

The backend already accepts `conversation_history` separately and inserts it into the chat messages. That means the formatted transcript may overlap somewhat with the structured history, even though it still works.

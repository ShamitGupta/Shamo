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

### `conversationHistory` vs `formattedConversationHistory`

These two variables represent the same recent chat history in two different formats.

`conversationHistory` is the structured version:

```js
const conversationHistory = messages
    .slice(-MAX_SESSION_MEMORY_MESSAGES)
    .map((message) => ({
        role: message.sender === 'user' ? 'user' : 'assistant',
        content: message.title,
    }));
```

This version:

- is an array of objects
- preserves the `role` and `content` fields separately
- is sent as `conversation_history` in the second API call
- is used by the backend as proper chat history

`formattedConversationHistory` is the plain-text version created from `conversationHistory`:

```js
const formattedConversationHistory = formatConversationHistory(conversationHistory);
```

This version:

- is a single string
- turns the chat into transcript lines like `User: ...` and `Assistant: ...`
- is inserted into `responsePrompt`

So the naming difference exists because the data formats are different:

- `conversationHistory` = structured JSON-like chat history
- `formattedConversationHistory` = readable text transcript

### Why both are currently being sent

In the second API call, the frontend sends:

1. `conversation_history: conversationHistory`
2. `user_prompt: responsePrompt`, where `responsePrompt` may already contain `formattedConversationHistory`

That means the same history is being provided twice:

- once as structured message history
- once as a transcript embedded inside the latest prompt

The backend already uses `conversation_history` directly when building `chat_messages`, so this makes `formattedConversationHistory` somewhat redundant in the current design.

The cleaner mental model is:

- `conversationHistory` is the real conversation memory
- `formattedConversationHistory` is an extra transcript version of that same memory

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

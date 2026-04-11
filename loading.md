# Task: Implement Loading Animation for Shamo Chatbot

## Objective
Add a simple, temporary loading indicator that appears after a user submits a prompt and disappears as soon as the AI response begins to stream.

## Constraints
- **Scope**: Modify only `src/ChatSection/ChatSection.jsx` and `src/ChatSection/ChatSection.module.css`.
- **No Backend Changes**: Do not alter any FastAPI endpoints or Python logic.
- **Simplicity**: Keep the animation and implementation lightweight.

## Implementation Details

### 1. Logic Updates (`ChatSection.jsx`)
- **New State**: Add an `isLoading` boolean state using `useState`.
- **Toggle Point**: 
    - Set `isLoading(true)` at the very beginning of the `handleSubmit` function.
    - Set `isLoading(false)` immediately before the `setMessages` call that adds the chatbot's empty title placeholder (`{ title: "", sender: 'chatbot' }`).
- **Conditional Rendering**: 
    - Inside the `.Chat` container, render a loading block only when `isLoading` is true. 
    - Place this block after the `messages.map` logic but before the `dummyRef` div so it stays at the bottom of the conversation.

### 2. UI Component Structure
- Create a `div` with a class like `styles.LoadingContainer`.
- Inside the container, include:
    - A `div` for the spinner (e.g., `styles.Spinner`).
    - A `p` tag for the text (e.g., `styles.LoadingText`).
- **Loading Text**: Use a simple string like "Understanding your question..." or "Crafting a response...".

### 3. Styling (`ChatSection.module.css`)
- **Spinner**: Create a small CSS circle (e.g., 20px x 20px) with a partial border-color to create a "gap."
- **Animation**: Use `@keyframes` to rotate the spinner 360 degrees infinitely.
- **Layout**: 
    - Ensure the `LoadingContainer` is aligned to the left (matching the `ResponseBubble` side) or centered.
    - Add sufficient padding/margin so it doesn't look cramped against the user's bubble.
- **Colors**: Use colors consistent with the existing theme (e.g., `#E0E0E0` for text and a subtle accent for the spinner).

## Target Files
- `src/ChatSection/ChatSection.jsx`
- `src/ChatSection/ChatSection.module.css`
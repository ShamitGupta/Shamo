# Task: UI/UX Refinement for Shamo AI Tutor

## Project Overview
Shamo is an AI-powered Mathematics tutor built with a **FastAPI** backend and a **React (Vite)** frontend. It helps students solve IGCSE Add Maths past papers by retrieving specific questions and mark schemes from Supabase and explaining them via GPT-4o.

## Constraints
- **NO BACKEND CHANGES**: Do not modify any files in the `Backend/` directory.
- **NO API CHANGES**: Do not change the existing fetch request structures or endpoint signatures.
- **FOCUS**: Purely on the React components and CSS modules within the `Chatbot/src/` directory.

## Required Tasks

### 1. Fix Streaming Scroll Jitter
- **Location**: `src/ChatSection/ChatSection.jsx` and `ChatSection.module.css`.
- **Problem**: The current auto-scroll implementation during streaming is not smooth.
- **Requirement**: Refine the `dummyRef` scrolling logic. Consider using `requestAnimationFrame` or CSS `scroll-behavior: smooth` to ensure that as the `accumulatedText` updates the state, the container follows the bottom of the message fluidly without stuttering.

### 2. Implement Metadata Dropdowns
- **Location**: `src/ChatSection/ChatSection.jsx`.
- **Requirement**: Add a set of dropdown selectors (Select components) above or integrated with the `ChatBox` input.
- **Fields to include**:
    - **Year**: (e.g., 2020-2024)
    - **Exam Session**: (May/June, Oct/Nov, Feb/March)
    - **Paper Variant**: (e.g., 11, 12, 13, 21, 22, 23)
    - **Question Number**: (1 through 15)
- **Logic**: Store these in a new React state. Ensure that when `handleSubmit` is called, it continues to send data to the backend in the format the API expects, but uses the values from these dropdowns to simplify the user's experience.

### 3. Cosmetic & Typography Overhaul
- **Typography**: Change the global font to a cleaner, more professional sans-serif (e.g., 'Inter', 'Outfit', or 'Plus Jakarta Sans'). Update `index.css` and module files.
- **Chat Bubbles**: Refine `ChatBubble` and `ResponseBubble` in `ChatSection.module.css`. Improve padding, border-radius, and subtle drop-shadows.
- **Sidebar**: Improve the `SidebarButtons` styling in `Sidebar.module.css`. Add better hover states and perhaps subtle active-state indicators.
- **Color Palette**: Stick to the dark theme (#121212, #212121) but adjust accent colors for better readability and a more modern "SaaS" aesthetic.

## Files Provided for Context
- `src/ChatSection/ChatSection.jsx` (Main Chat Logic)
- `src/ChatSection/ChatSection.module.css` (Chat Styling)
- `src/Sidebar/Sidebar.jsx` & `Sidebar.module.css` (Sidebar UI)
- `src/index.css` (Global Styles)
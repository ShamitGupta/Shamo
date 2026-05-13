# Shamo AI Tutor

## Product Overview & Business Idea
Shamo AI is an AI-powered Mathematics tutor specifically designed to help students master IGCSE Additional Mathematics and A-level Mathematics past papers. 
The core business proposition is to act as an expert tutor rather than a simple answer-generator. When a student struggles with a specific question from a past paper, they can provide the metadata (Year, Session, Variant, Question Number) and ask for help. Shamo retrieves the exact question paper and mark scheme from a database and uses GPT-4o to analyze the student's problem, providing step-by-step explanations, referencing the mark scheme, and guiding the student to the answer conceptually.

## High-Level Architecture
Shamo follows a client-server architecture with an external database and AI API integration:

1. **Frontend (React + Vite)**: A modern, responsive chat interface where students can input their questions and select the past paper metadata via dropdowns. It supports rich text rendering, including LaTeX for mathematical formulas.
2. **Backend (FastAPI)**: A lightweight Python backend that orchestrates the flow of data. It handles CORS, input validation, and serves two main purposes: extracting structured metadata from the query and streaming the AI's response.
3. **Database (Supabase)**: Stores the text representations of past paper questions and mark schemes. The backend queries Supabase based on the user's selected metadata to retrieve the exact context needed.
4. **AI Engine (OpenAI GPT-4o)**: Powers the extraction of metadata and the generation of the tutoring response.

## Why this Architecture?
- **Separation of Concerns**: The frontend solely handles user experience and UI, while the backend orchestrates API keys, database calls, and prompt engineering.
- **Streaming Support**: Mathematical explanations can be long. Streaming the response from the OpenAI API through the FastAPI backend to the React frontend ensures a fast, responsive user experience without long wait times.
- **Accuracy**: By injecting the exact Mark Scheme and Question Paper text directly into the GPT-4o prompt (RAG - Retrieval-Augmented Generation), hallucinations are minimized, and the AI acts strictly based on the official curriculum.

## For AI Agents / Developers
If you are taking over this codebase, please refer to `context.md` for a deep dive into the technical implementation, file structures, state management, and specific logic constraints.

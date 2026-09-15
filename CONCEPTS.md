# Shamo Chatbot Concepts

This file summarizes implementation questions and answers about the current Shamo chatbot. It is meant to be technical enough to trace back to the code, but simple enough to read as a product/engineering note.

## 1. How Do The Four Chatbot Modes Work?

**Question.** The chatbot currently has four modes: Hint, Explain, Check my work, and Visualize. How do they work? Do they have four different system prompts defining what they do with the extracted database content?

**Short answer.** There are four modes in the UI, but they are implemented as two backend pathways:

- `hint`, `explain`, and `check` all use `POST /chat`.
- `visualize` uses `POST /visualize`.

The three text modes share one prompt-building function. The backend builds a system prompt from:

1. shared base rules,
2. the selected mode's rules,
3. the retrieved official question context,
4. and, for Check mode only, an extra mark-attribution checklist.

Visualize has its own separate system prompt because it does not ask for normal prose. It asks the model to return a restricted JSON visual specification, which the backend validates before showing it to the student.

### Shared Grounding Step

All four modes start from the same principle: the browser sends only a reference to a question, not the question content itself.

Example reference:

```json
{
  "year": 2025,
  "exam_session": "oct_nov",
  "paper_variant": "51",
  "question_number": 4
}
```

The backend then retrieves the official published question from Supabase using the normalized corpus. If the question is not found, the backend returns `404` and does not call the model.

This is the core safety design: the model can only answer after the backend has loaded source content.

### Hint Mode

Hint mode uses the normal chat endpoint with `mode: "hint"`.

Its system prompt tells the model to:

- give only a small nudge,
- name the technique or first move,
- avoid working through the algebra,
- avoid revealing the final answer,
- end with a short question or invitation.

Important detail: Hint mode still receives the mark scheme in the source block. The difference is not what it knows; the difference is what it is allowed to reveal.

### Explain Mode

Explain mode uses the normal chat endpoint with `mode: "explain"`.

Its system prompt tells the model to:

- teach the full method,
- follow the mark scheme order,
- attach steps to marks such as `M1`, `A1`, `B1`,
- mention valid alternative methods where printed,
- finish with the official answer and required accuracy.

This is the full worked-solution mode.

### Check My Work Mode

Check mode uses the normal chat endpoint with `mode: "check"`.

The frontend sends the student's message as both:

- `message`, the ordinary chat message,
- and `attempt`, the working to diagnose.

The prompt tells the model to:

- diagnose the student's own working rather than replace it,
- say which marks are earned,
- find the first clear error,
- apply follow-through honestly,
- check the examiner guidance before awarding marks.

Check mode also adds a generated `MARK ATTRIBUTION CHECKLIST` to the system prompt. This checklist repeats every official mark row and makes conditions like "Both", "All", "must see", `FT`, `CAO`, and `AWRT` harder for the model to skim past.

### Visualize Mode

Visualize mode does not use `/chat`. The chat endpoint explicitly rejects `mode: "visualize"` and tells the client to use `/visualize`.

Visualize has a separate prompt that asks the model to return JSON, not ordinary tutoring prose. The JSON can describe safe visual artifacts such as:

- Desmos expressions,
- GeoGebra commands from a whitelist,
- Manim template videos using fixed templates and bounded parameters.

After the model returns JSON, the backend validates it. For Manim, the backend may render a video, upload it to private Storage, and return a signed URL. If the visual spec or render fails, the student gets a text fallback instead of an unsafe or broken visual.

### Multi-Select Modes In The Frontend

The frontend allows more than one mode to be selected at once. This does not create a blended prompt.

If the student selects Hint and Visualize together, the frontend sends:

- one independent `/chat` request for Hint,
- and one independent `/visualize` request for Visualize.

Each response gets its own slot in the chat UI. This keeps each mode's rules intact.

### Key Files

- `backend_v2/app/models.py` defines the `TutorMode` enum and request/response contracts.
- `backend_v2/app/main.py` defines `/chat`, `/visualize`, and the retrieval-before-model boundary.
- `backend_v2/app/repository.py` retrieves official question context from Supabase and signs private assets.
- `backend_v2/app/tutor.py` calls the model for the three text modes.
- `backend_v2/app/prompts.py` builds the text-mode system prompts.
- `backend_v2/app/visualize.py` builds the Visualize prompt and validates generated visual specs.
- `frontend/src/ChatSection/ChatSection.jsx` handles mode selection and sends one request per selected mode.
- `frontend/src/api/tutorApi.js` contains the frontend API calls.

## 2. If Hint, Explain, And Check Share A Prompt Builder, How Are Their Behaviours Different?

**Question.** If the first three modes share the same system prompt, how does Shamo ensure they behave differently?

**Short answer.** They share the same prompt-building function, but they do not receive identical final prompts.

The backend builds the final system prompt like this:

```text
shared base rules
+ selected mode rules
+ official source material
+ optional Check-mode checklist
```

The selected mode rules are different text blocks stored in `MODE_RULES` inside `backend_v2/app/prompts.py`.

So:

- Hint gets `MODE_RULES[TutorMode.HINT]`.
- Explain gets `MODE_RULES[TutorMode.EXPLAIN]`.
- Check gets `MODE_RULES[TutorMode.CHECK]`.

That means each request receives the same official question and mark scheme, but the model is given different instructions about what it may do with that source material.

### Why This Design Is Used

The system intentionally gives all three text modes the same source material. Even Hint mode sees the mark scheme.

The difference is **permission**, not **knowledge**:

- Hint knows the answer but is instructed not to reveal it.
- Explain is allowed to reveal the full solution.
- Check is instructed to mark the student's own attempt.

This avoids making Hint mode guess. If Hint mode did not see the mark scheme, it might give a hint that does not match the official method or marking conditions.

### Extra Guard For Check Mode

Check mode gets one more section that the other two do not: the `MARK ATTRIBUTION CHECKLIST`.

This is built from the same official mark rows, but repeated in a stricter checklist format. It exists because real testing showed that the model could correctly say an answer was incomplete, then accidentally award a mark anyway.

The checklist forces the model to ask, for every mark:

- What exact evidence did the student show?
- Did the examiner guidance condition pass?
- Is the mark earned, yes or no?

### What Enforces This In Code

In `backend_v2/app/tutor.py`, the tutor calls:

```python
system_prompt = build_system_prompt(context, mode, asset_urls_available)
```

In `backend_v2/app/prompts.py`, `build_system_prompt` inserts the relevant mode block:

```python
sections = [
    BASE_RULES,
    MODE_RULES[mode],
    build_source_block(context, asset_urls_available),
]
if mode is TutorMode.CHECK:
    sections.append(build_mark_attribution_checklist(context))
```

So the behaviour is controlled by:

1. the `mode` value in the API request,
2. the matching `MODE_RULES` block,
3. and the extra checklist for Check mode.

### Important Limitation

This is prompt-level enforcement, not a hard mathematical proof.

The code guarantees that the correct mode instructions are sent. It does not guarantee the model will always obey perfectly. That is why the project has tests and live evaluation cases, especially around Check mode's mark attribution.

## 3. How Many API Calls Happen When A Student Uses The Chatbot?

**Question.** If a user types a query in the chatbot, is the response generated through just one API call to the backend? Or are there multiple API calls, such as one to get past-paper data and another to generate the answer?

**Short answer.** Across the whole user workflow, there are multiple backend API calls. But for one submitted text-mode answer, the frontend sends one `/chat` request, and the backend itself retrieves the official question context before calling the model.

There are three main stages.

### Stage 1: Load The Published Paper Catalogue

When the frontend opens, it calls:

```text
GET /papers
```

This returns the list of published papers and question numbers. The dropdowns are built from this response, so the student can only choose questions that exist in the published corpus.

Frontend file: `frontend/src/ChatSection/usePaperCatalogue.js`

Backend file: `backend_v2/app/main.py`, route `list_papers`

### Stage 2: Load The Selected Question For Display

After the student selects a complete paper/question reference, the frontend calls:

```text
GET /papers/{year}/{exam_session}/{paper_variant}/questions/{question_number}
```

This fetches the question stem, parts, total marks, and signed diagram URLs so the student can see the question in the UI before asking anything.

The mark scheme is included in the backend response model's part objects, but the frontend deliberately does not render it in `QuestionPanel`.

Frontend files:

- `frontend/src/ChatSection/ChatSection.jsx`
- `frontend/src/ChatSection/QuestionPanel.jsx`

Backend file: `backend_v2/app/main.py`, route `get_question`

### Stage 3: Submit A Chat Query

When the student types a message and submits it, the frontend sends one request per selected mode.

For Hint, Explain, or Check:

```text
POST /chat
```

For Visualize:

```text
POST /visualize
```

Important: even though the frontend already fetched the question for display in Stage 2, the chat request does **not** send the question content back to the backend. It sends only the question reference.

Then the backend re-retrieves the official question context server-side before calling the model. This duplicate retrieval is deliberate. It prevents the browser from modifying the source material.

### Single Mode Example

If the student selects only Explain and asks a question, the workflow is usually:

```text
GET /papers
GET /papers/.../questions/N
POST /chat
```

The response generation itself happens through the `POST /chat` call. Inside that backend request, the backend:

1. receives the question reference and message,
2. retrieves official context from Supabase,
3. builds the system prompt,
4. calls the OpenAI model,
5. streams the answer back to the frontend.

### Multiple Mode Example

If the student selects Hint and Visualize together, the frontend sends two independent requests in parallel:

```text
POST /chat       mode = hint
POST /visualize  visual mode
```

They are not combined into one model prompt. Each mode has its own response slot in the UI.

### Why The Backend Re-Retrieves The Question

At first glance, it may look wasteful because the frontend already fetched the question for display.

But this is a safety boundary:

- the frontend display call is for the student,
- the backend retrieval inside `/chat` or `/visualize` is for grounding the model.

The model never trusts question text supplied by the browser. It always uses the official context loaded server-side.

### Simple Mental Model

Think of it like this:

```text
Page opens
  -> fetch catalogue

Student chooses question
  -> fetch question preview

Student asks something
  -> send mode request
      -> backend fetches official question again
      -> backend calls model
      -> backend returns answer
```

So yes, there are multiple API calls in the full workflow. But each individual mode response is produced by one backend generation request, with internal server-side retrieval before the model call.

### Clarified Three-Stage Interpretation

A useful way to say it is:

1. **Page opens: catalogue call.**

   The frontend calls the Python backend:

   ```text
   GET /papers
   ```

   The Python backend queries Supabase and returns the published catalogue: paper years, sessions, variants, components, and available question numbers. The frontend uses this to show how many papers are available and to build the dropdowns.

2. **User selects a paper/question: preview call.**

   The frontend calls:

   ```text
   GET /papers/{year}/{exam_session}/{paper_variant}/questions/{question_number}
   ```

   This retrieves the selected question, its parts, marks, source-document references, and signed asset URLs for diagrams. This is mainly for the UI preview before the student asks anything.

   Small caveat: the backend response model also contains mark-scheme rows, because the same structured context shape is used internally. But `QuestionPanel` deliberately does not render the mark scheme to the student.

3. **User submits a query: generation call.**

   This is the first point where the LLM is called.

   For Hint, Explain, or Check, the frontend calls:

   ```text
   POST /chat
   ```

   For Visualize, it calls:

   ```text
   POST /visualize
   ```

   The request sends only the question reference and the student's message. The backend retrieves the official question and mark scheme from Supabase again, builds the model prompt, calls the LLM, and returns the answer or visual response to the frontend.

The repeated retrieval is deliberate. The preview request is for the student-facing UI; the generation request re-retrieves the official context so the model never relies on question text sent back from the browser.

## 4. How Does The Visualize Endpoint Work?

**Question.** How does the Visualize endpoint work for Desmos, GeoGebra, and Manim? Is there pre-built skeleton code, with the LLM filling in values such as equations?

**Short answer.** Yes, that is the right mental model, with one important refinement: the LLM does **not** generate executable code. It generates a restricted JSON specification. The app already contains the code that knows how to render that spec.

For Desmos and GeoGebra, the frontend contains the renderer skeleton. For Manim, the backend contains fixed scene templates and renders a video before the frontend sees it.

### The Overall Flow

When the student chooses Visualize and submits a message, the frontend calls:

```text
POST /visualize
```

The backend then:

1. receives the question reference and the student's visual request,
2. re-fetches the official question context from Supabase,
3. builds a Visualize-specific system prompt,
4. asks the LLM to return JSON only,
5. validates the JSON against strict Pydantic models and safety rules,
6. for Desmos/GeoGebra, returns the validated spec to the frontend,
7. for Manim, renders a video on the backend, uploads it to private Storage, and returns a signed video URL.

### What The LLM Outputs

The LLM is asked to output a JSON object shaped like:

```json
{
  "visual_spec_version": "visual-v1",
  "message_markdown": "short explanation",
  "fallback_markdown": "text explanation if the visual fails",
  "artifacts": [
    {
      "artifact_kind": "desmos_2d",
      "title": "Graph of the region",
      "purpose": "Show the bounded area",
      "narration_markdown": "The shaded region is between the curve and line.",
      "accessibility_text": "A graph showing a shaded bounded region.",
      "desmos": {
        "calculator": "graphing",
        "viewport": {
          "left": 0,
          "right": 10,
          "bottom": 0,
          "top": 6
        },
        "expressions": [
          {
            "id": "curve",
            "latex": "y=0.5x+4/x"
          },
          {
            "id": "line",
            "latex": "y=4.5"
          },
          {
            "id": "shade",
            "latex": "0.5x+4/x \\le y \\le 4.5 \\left\\{1 \\le x \\le 8\\right\\}"
          }
        ]
      }
    }
  ]
}
```

That JSON is data, not code.

### Desmos

For Desmos, the frontend has pre-written rendering code in `VisualArtifactCard.jsx`.

The LLM supplies data such as:

- calculator type,
- viewport bounds,
- equations in LaTeX,
- sliders,
- colours,
- labels,
- whether points/lines/fills should appear.

The frontend loads the official Desmos script and calls Desmos's API with those validated expressions.

So yes: there is a reusable Desmos rendering skeleton, and the LLM fills in the graph-specific values.

### GeoGebra

GeoGebra works similarly, but the data is a list of whitelisted construction commands.

The LLM might output commands such as:

```text
A=(0,0)
B=(3,0)
Segment(A,B)
ShowLabel(A,true)
```

The backend rejects dangerous or unsupported commands before the frontend runs them. The frontend then loads GeoGebra's script and applies the approved commands.

### Manim

Manim is different because it produces a video, not an interactive browser widget.

The LLM still does not generate Python code. Instead, it chooses one fixed template, such as:

- `region_sweep`,
- `volume_of_revolution`,
- `tangent_line`,
- `cobweb_diagram`,
- `complex_transform`,
- `kinematics_motion`,
- `force_resultant`,
- `vector_line_3d`.

Then it supplies bounded parameters for that template.

Example:

```json
{
  "template": "volume_of_revolution",
  "volume_of_revolution": {
    "lower_expr": "0.5*x + 4/x",
    "upper_expr": "4.5",
    "x_min": 1,
    "x_max": 8,
    "lower_label": "y = 0.5x + 4/x",
    "upper_label": "y = 4.5"
  }
}
```

The backend validates the expressions using a restricted arithmetic parser, renders the fixed Manim scene in a subprocess, uploads the MP4 to private Supabase Storage, and returns a temporary signed URL.

The frontend just displays the returned video in a normal `<video>` element.

### Why JSON Specs Instead Of Code?

This is a safety choice.

The dangerous version would be: "LLM, write some JavaScript or Python and we will run it."

Shamo does not do that.

Instead:

- Desmos: LLM supplies validated expressions, not JavaScript.
- GeoGebra: LLM supplies whitelisted commands, not arbitrary scripts.
- Manim: LLM supplies bounded parameters, not Python scene code.

The app owns the renderer logic. The model only fills in controlled data.

### Where The Code Lives

- `backend_v2/app/visualize.py` builds the Visualize prompt, parses model JSON, and validates specs.
- `backend_v2/app/models.py` defines the allowed visual schema.
- `backend_v2/app/safe_math.py` validates model-supplied arithmetic expressions for Manim.
- `backend_v2/app/manim_renderer.py` renders approved Manim specs into MP4 files.
- `backend_v2/app/manim_templates/` contains the fixed Manim scene templates.
- `frontend/src/ChatSection/VisualArtifactCard.jsx` renders Desmos, GeoGebra, and Manim artifacts in the UI.

## 5. Why Are Desmos And GeoGebra Renderers In The Frontend?

**Question.** For Desmos and GeoGebra, why is the skeleton code in the frontend instead of the backend?

**Short answer.** Desmos and GeoGebra are interactive browser widgets. The backend validates what should be drawn, but the frontend is where the widget must actually be created, because it needs a real browser DOM element to mount into.

### Backend Responsibility

The backend's job is to decide whether a generated visual is safe and valid.

For Desmos, it checks that the model output fits the allowed schema: expressions, sliders, viewport bounds, labels, colours, and so on.

For GeoGebra, it checks that commands are in an allowed shape and use whitelisted constructors/commands.

If the spec is unsafe, malformed, or contains executable text/URLs, the backend rejects it and returns a fallback explanation.

So the backend acts like a gatekeeper:

```text
LLM JSON output
-> backend validation
-> safe visual spec
```

### Frontend Responsibility

The frontend's job is to display the approved visual.

Desmos and GeoGebra both provide JavaScript libraries designed to run in the browser. They need:

- a real HTML container,
- script loading,
- browser events,
- resizing/layout,
- user interaction such as dragging, zooming, sliders, and controls.

That is why `VisualArtifactCard.jsx` creates the Desmos calculator or GeoGebra applet in the frontend.

The frontend renderer is the reusable skeleton. The validated spec supplies the changing values.

### Why Not Render Them In The Backend?

The backend could theoretically generate a static image or screenshot, but that would lose the main benefit of Desmos/GeoGebra: interactivity.

If the backend rendered it, the student would likely receive a flat image. They could not drag sliders, zoom, inspect expressions, or interact with the construction naturally.

The current design keeps the best split:

```text
Backend: validate and protect
Frontend: render and interact
```

### Why Manim Is Different

Manim is not an interactive browser widget. It is a Python animation engine that produces a video file.

That means the backend must render it, because:

- Manim runs as Python, not browser JavaScript,
- rendering can take several seconds,
- rendering needs a controlled subprocess and timeout,
- the finished result is an MP4 that the frontend can simply play.

So the split is:

- Desmos/GeoGebra: validate in backend, render interactively in frontend.
- Manim: validate in backend, render video in backend, play video in frontend.

## 6. Where Are The Manim Templates Stored?

**Question.** Are the Manim templates stored as code files in the project folder, or are they stored inside Supabase and fetched by the backend?

**Short answer.** The Manim templates are stored as Python code files in the project folder. They are not stored in Supabase.

The fixed scene templates live in:

```text
backend_v2/app/manim_templates/
```

Examples include:

- `region_sweep.py`
- `volume_of_revolution.py`
- `tangent_line.py`
- `cobweb_diagram.py`
- `complex_transform.py`
- `kinematics_motion.py`
- `force_resultant.py`
- `vector_line_3d.py`

The backend renderer has a hardcoded mapping from template name to local scene file and scene class in:

```text
backend_v2/app/manim_renderer.py
```

Conceptually:

```text
LLM chooses template name + parameters
-> backend validates parameters
-> backend looks up local template file
-> backend runs Manim on that local file
-> backend uploads the rendered MP4 to Supabase Storage
```

### What Supabase Stores

Supabase does not store the Manim Python template source.

Supabase is used for:

- retrieving the official question/mark-scheme context,
- storing or reading cached visual artifact specs,
- storing generated Manim MP4 files in private Storage,
- creating signed URLs so the frontend can play those videos.

So the template source is part of the deployed backend code, while the generated video output is stored in Supabase.

### Why This Matters

Keeping templates in code makes them reviewable and version-controlled. The LLM cannot create or modify Manim Python code at runtime. It can only choose one of the approved templates and provide bounded parameters.

That is the main safety boundary for Manim.

## 7. What Does Supabase Store?

**Question.** What exactly does Supabase store? Explain with an example.

**Short answer.** Supabase stores Shamo's data and generated files. It does not store the application logic.

Think of Supabase as holding:

1. the official published past-paper content,
2. private image assets from papers,
3. generated visual outputs such as Manim MP4 videos,
4. cached visual response specs,
5. operational ingestion/indexing records.

The backend code decides what to do with that data.

### Example: A Student Asks For A Manim Visual

Suppose the student selects:

```text
9709/13 Oct/Nov 2025 Question 9
```

and asks:

```text
Can you visualize the volume when this region is rotated about the x-axis?
```

Here is what Supabase stores and returns.

### 1. Official Question Content

Supabase stores the published question data in normalized tables.

For this question, Supabase may store:

```text
Paper:
9709/13 Oct/Nov 2025

Question:
Question 9

Stem:
The curve has equation ...
The region is bounded by ...

Parts:
(a), (b), etc.

Mark scheme:
M1, A1, B1 rows with official answer/guidance text.
```

The backend retrieves this using the database function:

```text
shamo_get_question_context
```

This gives the backend the official source material to put into the LLM prompt.

### 2. Paper Assets Such As Diagrams

If a question has a required diagram, the image file is stored in private Supabase Storage.

Example:

```text
Bucket: past-paper-assets
Path: a_level/9709/2025/oct_nov/13/q9/page-...jpg
```

The frontend cannot freely browse this bucket. The backend creates a temporary signed URL, such as:

```text
https://...signed-url-that-expires...
```

The frontend uses that URL to display the diagram.

### 3. Generated Manim Video Output

The Manim template itself is local backend code, not Supabase data.

But once the backend renders the animation, the generated MP4 is uploaded to Supabase Storage.

Example:

```text
Bucket: shamo-generated-media
Path: visualize/<question_id>/<hash>.mp4
```

Supabase stores the finished video file. The backend returns a signed URL so the frontend can play it.

### 4. Cached Visual Spec

Supabase can also store the validated visual response JSON in a table such as:

```text
shamo_visual_artifacts
```

This cache might contain:

```json
{
  "visual_spec_version": "visual-v1",
  "message_markdown": "Watch the region rotate about the x-axis.",
  "artifacts": [
    {
      "artifact_kind": "manim_template_video",
      "title": "Rotating the region",
      "manim": {
        "template": "volume_of_revolution",
        "volume_of_revolution": {
          "lower_expr": "0.5*x + 4/x",
          "upper_expr": "4.5",
          "x_min": 1,
          "x_max": 8
        }
      },
      "video_storage_path": "visualize/<question_id>/<hash>.mp4"
    }
  ]
}
```

The important part is `video_storage_path`. Signed URLs expire, but the storage path is durable. On a later cache hit, the backend re-signs that stored path and gives the frontend a fresh temporary video URL.

### What Supabase Does Not Store

Supabase does **not** store:

- the React frontend code,
- the FastAPI backend code,
- the Manim Python template files,
- the Desmos/GeoGebra rendering skeleton code,
- the prompt-building functions.

Those live in the project codebase.

### Simple Analogy

Use this mental model:

```text
Project code = the machine / instructions
Supabase database = official paper data
Supabase Storage = private files and generated media
LLM = produces controlled response/spec from official data
Frontend = displays the result
```

For the Manim example:

```text
Supabase provides:
- the official question
- the official mark scheme
- any paper diagrams
- the place to store the generated MP4

Backend provides:
- retrieval logic
- prompt construction
- validation
- local Manim template code
- rendering process

Frontend provides:
- the chat UI
- the video player
```

## 8. Does Supabase Store Every Generated Manim Video? What Is A Cached Visual Spec?

**Question.** Does Supabase store every Manim video generated and shown to the student? Also, what does "cached visual spec" mean?

**Short answer.** Every successfully generated Manim video that is returned to the student is uploaded to Supabase Storage. But it is not stored as a new random file every time. It is stored using a hash of the Manim spec, so the same animation can reuse the same file path.

Cached visual specs are saved JSON records that remember what visual was generated for a given question and student prompt, so the backend does not need to ask the LLM and re-render the same visual again.

### Manim Video Storage

When `/visualize` returns a Manim animation, the backend has to render an MP4 first.

The flow is:

```text
LLM returns Manim JSON spec
-> backend validates it
-> backend renders MP4 with local Manim template
-> backend uploads MP4 to Supabase Storage
-> backend returns signed video URL to frontend
```

The MP4 is stored in the private bucket:

```text
shamo-generated-media
```

with a path shaped like:

```text
visualize/<question_id>/<spec_hash>.mp4
```

The `spec_hash` is computed from the Manim spec. So if the same question gets the exact same Manim spec again, it maps to the same storage path.

That means:

- it does store successful generated Manim videos,
- it does not store the Manim template source code,
- it does not necessarily create a brand-new separate file for every identical repeated request.

### What Happens On A Render Failure?

If Manim rendering fails, or upload fails, the backend drops the video artifact and returns a text fallback.

In that case, the failed video is not cached as a successful result.

### What Is A Visual Spec?

A visual spec is the structured JSON description of a visual.

For example, a Manim visual spec might say:

```json
{
  "artifact_kind": "manim_template_video",
  "title": "Rotating the region",
  "manim": {
    "template": "volume_of_revolution",
    "volume_of_revolution": {
      "lower_expr": "0.5*x + 4/x",
      "upper_expr": "4.5",
      "x_min": 1,
      "x_max": 8
    }
  },
  "video_storage_path": "visualize/<question_id>/<spec_hash>.mp4"
}
```

For Desmos, a visual spec might contain equations, sliders, and viewport bounds.

For GeoGebra, it might contain whitelisted construction commands.

The spec is not the rendered visual itself. It is the recipe/data needed to create or display the visual.

### What Does Cached Visual Spec Mean?

After the backend validates a visual response, it can store the full validated JSON response in the database table:

```text
shamo_visual_artifacts
```

It is stored against:

- the exact question ID,
- a hash of the student's prompt,
- the visual spec version,
- the validated response payload.

So if the same question receives the same visual prompt again, the backend can do this:

```text
Check cache
-> find previous validated spec
-> skip LLM call
-> skip Manim render if video already exists
-> re-sign the stored video path
-> return response quickly
```

### Why Re-Sign The Video URL?

The cached spec stores the durable path:

```text
visualize/<question_id>/<spec_hash>.mp4
```

It does not rely on the old signed URL, because signed URLs expire.

On a cache hit, the backend creates a fresh signed URL from the stored path and returns that to the frontend.

### Simple Example

First request:

```text
Student: "Show the region rotating about the x-axis"
Backend: asks LLM, validates spec, renders MP4, uploads video, stores cached spec
```

Second identical request:

```text
Student: "Show the region rotating about the x-axis"
Backend: finds cached spec, re-signs existing MP4 URL, returns it
```

No new LLM call and no new render are needed for that exact cache hit.

## 9. What Happens If A Manim Animation Has No Template Yet?

**Question.** Does Manim only support certain fixed templates? What happens if a student asks for an animation that has no template yet?

**Short answer.** Yes. Manim currently supports only a fixed list of approved templates. If the requested animation does not fit one of those templates, the backend should not render arbitrary new animation code. The response should fall back to another safe visual type, such as Desmos/GeoGebra, or to a text explanation.

### Current Manim Template Boundary

The backend only knows how to render templates listed in `ManimTemplate` and mapped in `manim_renderer.py`.

Current template examples include:

- `region_sweep`
- `volume_of_revolution`
- `tangent_line`
- `cobweb_diagram`
- `complex_transform`
- `kinematics_motion`
- `force_resultant`
- `vector_line_3d`

The LLM is allowed to choose from these templates and fill in their parameters. It is not allowed to invent a new Manim scene.

### Example Of A Supported Request

Student asks:

```text
Can you animate this region rotating around the x-axis?
```

If the question matches a volume-of-revolution shape, the LLM can choose:

```json
{
  "template": "volume_of_revolution"
}
```

with the required expressions and bounds.

The backend validates and renders it.

### Example Of An Unsupported Request

Student asks:

```text
Can you animate a 3D projectile motion path with air resistance?
```

If there is no approved Manim template for that shape, the model should not create Python code for it.

Instead, one of these should happen:

1. The LLM chooses a different supported visual type, such as a static Desmos/GeoGebra graph, if that can still help.
2. The LLM returns a text fallback explaining that a trusted animation is not available for this request.
3. If the LLM wrongly tries to invent an unsupported Manim template, backend validation rejects the visual spec and returns the fallback text.

### What If The LLM Tries To Invent A Template?

The schema only accepts known template names.

If the LLM outputs something like:

```json
{
  "template": "projectile_motion_3d"
}
```

and that template is not in the enum, validation fails. The backend does not render anything.

The student receives a safe fallback response rather than an unsafe or broken animation.

### Why This Is Intentional

Allowing the LLM to generate arbitrary Manim Python code would mean executing model-written Python on the backend. That would be a serious security risk, especially because the backend has access to service credentials.

So the rule is:

```text
New animation type requires new reviewed backend template code.
```

The LLM can use templates. It cannot create templates.

## 10. Can Fixed Manim Templates Hurt Student Experience?

**Question.** Can the fixed-template Manim design negatively affect the student experience? Can anything be done so the chatbot can animate whatever the student asks?

**Short answer.** Yes, fixed templates can limit the student experience because some requests will not have a matching animation. But trying to animate literally anything by letting the LLM generate arbitrary Manim code would be unsafe and unreliable. The better goal is not "animate anything"; it is "handle unsupported requests gracefully, and steadily expand high-quality template coverage."

### The Student-Experience Risk

A student might ask:

```text
Can you animate this transformation?
```

or:

```text
Can you show this 3D geometry moving?
```

If there is no matching Manim template, the app cannot produce that exact animation. That can feel disappointing, especially if the student expected Visualize to always mean "make an animation."

The risk is:

- the student asks for an animation,
- the chatbot cannot make that exact animation,
- the fallback feels weaker than expected.

### Why Not Animate Anything?

The unsafe version would be:

```text
LLM writes custom Python Manim code
Backend executes it
```

That would allow the model to generate code that runs on the backend. Even with sandboxing, this creates serious risks:

- arbitrary code execution,
- credential exposure,
- filesystem access,
- slow or infinite renders,
- broken animations,
- hard-to-debug failures,
- inconsistent educational quality.

So "animate anything" is not a safe target if it means dynamic model-written code.

### Better Product Goal

The better target is:

```text
Animate the common exam-relevant visual patterns well.
Fallback gracefully for everything else.
Keep expanding templates based on real student demand.
```

This fits Shamo's purpose because the content is a known past-paper corpus. The team can inspect the corpus, identify recurring question shapes, and build reviewed templates for those shapes.

### Ways To Improve The Experience

1. **Capability-aware routing**

   Before promising an animation, the Visualize prompt should guide the model to choose only supported templates. If none fits, it should choose Desmos, GeoGebra, or text fallback instead.

2. **High-quality fallback responses**

   Unsupported animation should not feel like an error. A good fallback can say:

   ```text
   I cannot make a trusted animation for that exact request yet, but I can show the key relationship on a graph.
   ```

   Then it can provide a Desmos or GeoGebra visual where possible.

3. **Use Desmos/GeoGebra for broader coverage**

   Many visuals do not need Manim. Static or interactive browser tools can cover graph shading, intersections, sliders, loci, geometry constructions, and 3D graphing.

   These are often more useful than a video because the student can interact with them.

4. **Build templates from real corpus demand**

   Instead of guessing, inspect which unsupported visual requests happen often. Then add templates for recurring patterns.

   Example template expansion strategy:

   ```text
   Log unsupported visual requests
   -> group them by mathematical shape
   -> build the highest-value safe template
   -> add tests and live visual QA
   -> release it
   ```

5. **Set expectations in the UI**

   The mode name "Visualize" is better than "Animate anything" because Visualize can mean graph, construction, or animation.

6. **Future internal template tooling**

   A future internal tool could help developers add and review templates faster. But templates should still become reviewed backend code, not model-generated code executed directly.

### What Not To Do

Avoid this:

```text
Student asks anything
-> LLM writes arbitrary Manim code
-> backend runs it
```

That would increase apparent flexibility but reduce safety, reliability, and trust.

### Practical Answer

So yes, the fixed-template approach can sometimes limit the student experience. But it is the right safety boundary.

The best improvement path is:

```text
Safe fixed templates
+ strong Desmos/GeoGebra fallback
+ friendly unsupported-animation messaging
+ analytics on missed requests
+ steady expansion of reviewed templates
```

That will not guarantee every possible animation, but it can make Visualize useful for most real exam questions without turning the backend into a dynamic code-execution service.

## 11. Can A Student Know In Advance Whether A Question Has An Animation?

**Question.** Is there any way the student can know before asking whether the question they are looking at has a possible Manim animation?

**Short answer.** Currently, not as a dedicated UI feature. The student can choose Visualize, but the app does not appear to show a precomputed "animation available" badge for the selected question before the student asks.

Right now, animation selection happens at request time:

```text
Student asks Visualize
-> backend retrieves question context
-> LLM decides whether a Desmos, GeoGebra, Manim, or fallback response fits
-> backend validates the result
-> frontend displays what survived validation
```

So the student finds out after submitting the Visualize request.

### Why It Is Not Obvious In Advance

The existence of a Manim template is not tied directly to a whole paper question ID.

It depends on whether the question's mathematical shape matches a supported template.

For example:

- A volume-of-revolution question may fit `volume_of_revolution`.
- A tangent/gradient question may fit `tangent_line`.
- A vector-line question may fit `vector_line_3d`.
- A complex-number multiplication question may fit `complex_transform`.

But a question can have several parts, and only one part might be animation-friendly. The student request also matters: "show the graph" might be Desmos, while "animate the rotation" might be Manim.

### How This Could Be Improved

A good future design would add a backend capability check for the selected question.

For example:

```text
GET /papers/.../questions/N/visual-capabilities
```

could return something like:

```json
{
  "has_visuals": true,
  "has_manim_animation": true,
  "supported_templates": ["volume_of_revolution"],
  "suggested_visual_prompts": [
    "Animate the region rotating about the x-axis",
    "Show the shaded region on a graph"
  ]
}
```

The frontend could then show a small UI hint such as:

```text
Animation available
```

or:

```text
Graph visual available
```

### How The Backend Could Know

There are a few possible strategies.

1. **Metadata-based detection**

   Use reviewed question metadata such as topic, method, and subtopic to infer likely templates.

   Example:

   ```text
   method includes "volume of revolution"
   -> template candidate: volume_of_revolution
   ```

2. **Rule-based detection from question text**

   Scan the official question text for reliable phrases.

   Example:

   ```text
   "rotated through 360 degrees about the x-axis"
   -> volume_of_revolution
   ```

3. **Offline precomputation**

   Run an internal classifier over all published questions and store possible visual capabilities in the database.

   Example table concept:

   ```text
   question_id
   visual_type
   template_name
   confidence
   reviewed_status
   suggested_prompt
   ```

4. **On-demand classification**

   When the question preview loads, the backend could classify possible visual types then. This is more flexible, but it may cost latency and model calls unless cached.

### Best Recommendation

For Shamo, the best path would likely be a reviewed or semi-reviewed capability map:

```text
Published question
-> detect possible visual templates offline
-> store visual capability metadata
-> frontend shows badges/prompts before the student asks
```

That gives students useful expectation-setting without letting the LLM freely promise animations that the backend cannot render.

### Current State In One Sentence

Currently the student can discover animation availability by asking Visualize, but the app does not yet show a reliable "this question has a Manim animation available" indicator before the request.

## 12. How Does Mode Switching Work During A Conversation?

**Question.** If a student first wants a Hint, then later wants to solve the whole question and use Check my work, do they have to keep checking and unchecking boxes? Does previous chat context remain? Is the current design inconvenient?

**Short answer.** Currently, the selected modes are sticky checkboxes. They remain selected until the student changes them. The chat history remains as long as the selected question stays the same. If the student changes to a different question, the frontend clears the conversation.

### Current Behaviour

The frontend stores selected modes in:

```text
selectedModes
```

inside:

```text
frontend/src/ChatSection/ChatSection.jsx
```

The default is:

```js
['explain']
```

If the student selects Hint only and sends a message, the app sends one Hint request.

If the student later also selects Check, and leaves Hint selected, the next submission sends both:

```text
POST /chat mode=hint
POST /chat mode=check
```

So yes: if the student wants only Check after previously using Hint, they need to uncheck Hint and check Check.

### Does Previous Context Remain?

Yes, as long as the student stays on the same question.

The frontend keeps the conversation in local React state and sends recent turns as `history` on later requests.

Current simplified flow:

```text
Student asks for Hint
-> assistant gives hint

Student switches to Check and submits working
-> request includes recent chat history
-> backend retrieves same official question again
-> model sees source material + recent conversation history
```

If the student changes the selected paper/question, the frontend clears the messages. This is deliberate, because carrying history from one question to another could confuse the grounding.

### Is This Inconvenient?

Potentially, yes.

Sticky multi-select modes are powerful when the student wants combined help, such as:

```text
Hint + Visualize
```

But they can be awkward for a natural tutoring flow:

```text
First give me a hint.
Now check my working.
Now explain the full solution.
```

In that flow, the student may need to keep toggling modes on and off.

### What Could Improve It?

There are several UX options.

1. **Per-message mode buttons**

   Instead of sticky checkboxes only, the input area could have direct send buttons:

   ```text
   Send as Hint
   Send as Explain
   Send as Check
   Send as Visualize
   ```

   This makes each turn's intent explicit without forcing the student to manage persistent checkbox state.

2. **Quick follow-up actions**

   After a Hint response, the UI could show buttons such as:

   ```text
   Explain fully
   Check my working
   Add visual
   ```

   Clicking one would run that mode for the next turn.

3. **Primary mode + optional add-ons**

   The UI could separate:

   ```text
   Primary response: Hint / Explain / Check
   Add-ons: Visualize
   ```

   This would avoid accidentally sending Hint and Explain together unless the student really means to.

4. **Mode presets**

   Common flows could be one-click presets:

   ```text
   "I need a nudge" -> Hint
   "Check my solution" -> Check
   "Teach me fully" -> Explain
   "Show me visually" -> Visualize
   ```

5. **Auto-suggest next mode**

   If the student says "here is my working" or pastes several lines of maths, the UI or backend could suggest Check mode. It should suggest rather than silently switch, because mode choice affects how much is revealed.

### Best Recommendation

Keep multi-select because it is useful, but add a faster per-turn workflow.

A good product shape would be:

```text
Sticky mode chips remain available
+ each message can be sent as a specific mode
+ follow-up buttons help the student move from Hint -> Check -> Explain
```

That preserves the current power feature while making the ordinary tutoring flow less fiddly.

## 13. How Are Multi-Mode Responses Coordinated Now?

**Question.** Are the four modes completely independent? If a student selects Explain and Visualize and asks for an animation, can Explain say "I cannot make an animation" while Visualize actually renders one? Is that a UX problem, and what was the fix?

**Short answer.** That contradiction could happen in the old multi-mode design because each selected mode ran as an independent request. Shamo now has a coordinated multi-mode endpoint, `POST /respond`, so multi-mode turns are handled together instead.

### The Old Problem

The old frontend flow for Explain + Visualize was:

```text
Student selects Explain + Visualize
-> POST /chat mode=explain
-> POST /visualize
```

Those requests ran in parallel. Explain did not know that Visualize was also handling the animation.

So if the message was:

```text
Can you animate the region rotating about the x-axis?
```

Explain could respond:

```text
I cannot make an animation.
```

while Visualize successfully rendered a Manim animation. Both responses made sense locally, but together they felt contradictory.

### The Implemented Fix

For multi-mode submissions, the frontend now calls:

```text
POST /respond
{
  "question": ...,
  "message": ...,
  "modes": ["explain", "visualize"]
}
```

The backend now:

1. retrieves the official question once,
2. keeps the selected modes together as one turn,
3. tells text prompts which other modes are active,
4. runs the relevant text and/or visual handlers,
5. returns one labelled response per selected mode.

### What Text Modes Are Told

When Explain is run alongside Visualize, the Explain prompt gets coordination guidance like:

```text
Visualize is handling any graph, construction, or animation request.
Do not say you cannot make a graph or animation; explain the mathematics while the visual response handles the visual.
```

This means Explain should explain the maths, while Visualize handles the graph/animation.

### What Still Stays Separate

The mode rules are still separate.

Hint still follows Hint rules. Explain still follows Explain rules. Check still follows Check rules. Visualize still returns a validated visual spec.

The difference is that the selected modes now know they belong to the same student turn.

### Single-Mode Requests

Single-mode requests still use the older direct paths:

```text
Explain only -> POST /chat
Visualize only -> POST /visualize
```

This keeps streaming for single text-mode replies and avoids unnecessary orchestration when only one mode is selected.

### Remaining UX Improvements

The orchestrator fixes the contradiction problem, but there is still room for UX improvements:

- better per-message mode buttons,
- follow-up buttons such as "Now check my work" or "Explain fully",
- primary mode plus optional Visualize add-on,
- suggestions when the input looks like student working.

Those are convenience improvements, not the core contradiction fix.

## 14. What Feature Was Built, And What Difference Should A Student Notice?

**Question.** What feature was built, what problem does it solve, how was it fixed, and what should look different when using the app?

**Short answer.** The feature is a coordinated multi-mode response flow. It does not add a new tutoring mode. It makes the existing modes work together better when more than one mode is selected.

### The Problem It Solves

Before this change, selecting multiple modes meant the frontend made separate backend calls.

For example:

```text
Explain selected   -> /chat
Visualize selected -> /visualize
```

Those two calls did not know about each other.

So the app could produce an awkward same-turn contradiction:

```text
Explain:   I cannot make an animation.
Visualize: Here is the animation.
```

This was not because either endpoint was broken. It happened because they were independent.

### The Fix

The app now has a backend coordinator:

```text
POST /respond
```

When more than one mode is selected, the frontend sends one request containing all selected modes.

The backend then:

1. retrieves the official question and mark scheme once,
2. sees the full selected-mode list,
3. tells text modes when Visualize is also active,
4. runs each mode's normal logic,
5. returns labelled responses such as Explain, Visualize, Check, or Hint.

The important detail is that the modes are coordinated, not merged into one giant answer.

### What Should Feel Different

If a student selects Explain + Visualize and asks:

```text
Can you animate this?
```

the expected behavior is now:

```text
Explain:   explains the mathematics behind the animation
Visualize: renders the graph, GeoGebra construction, or Manim video if supported
```

Explain should no longer say "I cannot animate this" while Visualize is doing exactly that.

### What Did Not Change

Single-mode behavior did not really change.

```text
Explain only   -> still uses /chat
Hint only      -> still uses /chat
Check only     -> still uses /chat
Visualize only -> still uses /visualize
```

So the main visible difference appears when more than one mode is selected.

Also, this does not mean Shamo can animate every possible request. Visualize is still limited by the supported Desmos, GeoGebra, and fixed Manim-template capabilities.

## 15. Does `/respond` Concatenate The System Prompts?

**Question.** Before, were there only `/chat` and `/visualize`? Now are those used only for single-mode requests, while multiple selected modes use `/respond`? And if Explain + Visualize are selected, are their system prompts concatenated together?

**Short answer.** Yes, single-mode requests still use `/chat` or `/visualize`, while multi-mode requests now use `/respond`. But no, `/respond` does not concatenate the Explain and Visualize system prompts into one combined prompt.

### Endpoint Routing

The frontend now behaves like this:

```text
One text mode selected
-> POST /chat

Only Visualize selected
-> POST /visualize

Two or more modes selected
-> POST /respond
```

So if the student selects:

```text
Explain + Visualize
```

the frontend sends one request to:

```text
POST /respond
```

### What `/respond` Does Internally

`/respond` is an orchestrator. It coordinates the selected modes, but each mode still keeps its own job.

For Explain + Visualize, the backend flow is roughly:

```text
1. Retrieve the official question context once.
2. See that selected modes are ["explain", "visualize"].
3. Run Explain as an Explain response.
4. Run Visualize as a Visualize response.
5. Return both labelled responses to the frontend.
```

### What Happens To The System Prompt

For the Explain part, the backend builds an Explain prompt.

It includes:

```text
base tutor rules
+ Explain mode rules
+ coordination note saying Visualize is also active
+ official question and mark scheme context
```

It does **not** include the full Visualize system prompt.

For the Visualize part, the backend uses the Visualize flow, which asks for a validated visual spec.

So the system does not make one prompt like:

```text
Explain prompt + Visualize prompt
```

Instead, it is closer to:

```text
Explain response:
  Explain prompt + "Visualize is also handling the visual"

Visualize response:
  Visualize prompt/spec flow
```

### Why This Is Better

Concatenating prompts would create conflicts.

For example, Hint says "do not reveal the answer", while Explain says "work through the full solution and end with the printed answer". If those were merged into one prompt, the model would receive contradictory instructions.

The orchestrator avoids that by keeping each mode separate, while giving each one just enough awareness of the others to avoid awkward contradictions.

## 16. Why Did The Explain Response Still Feel Uncohesive Beside Visualize?

**Question.** I selected Explain + Visualize for 2025 Oct/Nov Paper 13 Question 9. Visualize ran normally, but the Explain response still felt like it lacked cohesion. Is that response ideal?

**Short answer.** No, it was not ideal. It had a cohesion problem, and it may also have had a mathematical setup problem depending on the exact shaded region in the official question.

### What Was Useful

The Explain response did some useful work:

- identified the region between the curve and the line,
- found the intersection limits \(x = 1\) and \(x = 8\),
- connected the rotation to a volume integral.

So it was not a total failure.

### Possible Mathematical Problem

Based on the screenshot, the region is described as the region between:

```text
the curve y = 1/2 x + 4/x
and the horizontal line y = 4.5
```

If that is the region being rotated about the x-axis, then the volume should usually be treated as a washer:

```text
V = pi integral [(outer radius)^2 - (inner radius)^2] dx
```

Here the outer radius would be the line \(y = 4.5\), and the inner radius would be the curve.

So the setup would look like:

```text
V = pi integral from 1 to 8 of [4.5^2 - (1/2 x + 4/x)^2] dx
```

The screenshot's Explain response instead used:

```text
V = pi integral from 1 to 8 of (1/2 x + 4/x)^2 dx
```

That is the disk formula for rotating the region under the curve about the x-axis. It does not match "the region between the curve and the line" unless the official question/diagram defines the shaded region differently.

### What Felt Weak Cohesion-Wise

It still read like a standalone text explanation, not like one half of a coordinated Explain + Visualize response.

The clearest symptom was the ending:

```text
If you want, I can next help you picture why the limits are 1 and 8...
```

But the student had already selected Visualize. The app was already showing the picture/animation. So the Explain response should not behave as if visual help is a future optional step.

### Better Expected Behavior

For Explain + Visualize, the Explain response should sound more like:

```text
In the visual, watch the shaded region between the curve and the line.
The two intersection points mark the limits x = 1 and x = 8.
When the region rotates about the x-axis, each vertical slice becomes a circular cross-section.
That is why the volume setup is ...
```

That creates one coherent tutoring moment:

```text
Visualize shows the movement.
Explain narrates what the student should notice and why it matters.
```

### Fix Applied

The coordination prompt was strengthened so that when Visualize is selected alongside a text mode, the text mode is told to:

- write as a companion to the visual,
- name what the student should look for in the visual,
- connect visible features to the method,
- avoid offering to help the student picture it later.

This is a prompt-level improvement. It should improve cohesion, but because the answer is still generated by an LLM, it should be watched in real use and evaluated with examples like this one.

A second prompt guard was also added for volumes of revolution: Explain mode is now reminded to identify the actual shaded region and axis first, and to use the washer formula when a region is between two curves/lines rather than between a curve and the x-axis.

## 17. Why Did Explain Treat Cylinder Volume And Curve Volume As Alternative Methods?

**Question.** For the same question, Explain said there were two equivalent ways: using the outer radius directly, and using the curve in the integral. But in reality these are not alternatives. The correct method subtracts the curve volume from the outer cylinder volume to get \(343\pi/6\). Is the database wrong, or is this retrieval/system-prompt behavior?

**Short answer.** The stored data appears to contain the needed pieces. The failure is mainly a prompt/source-structure interpretation issue: the model saw separate mark-scheme rows and wrongly explained them as separate options, instead of combining them as parts of one calculation.

### What The Database Stores For This Question

For 2025 Oct/Nov Paper 13 Question 9, the stored stem says:

```text
The diagram shows part of the curve y = 1/2 x + 4/x and the line y = 4.5.
Find the exact volume of the solid formed when the shaded region is rotated about the x-axis.
```

The stored mark-scheme rows include:

```text
Main method row:
pi * 4.5^2 * (8 - 1)
```

This is the outer cylinder volume.

They also include:

```text
Main method row:
pi integral (1/2 x + 4/x)^2 dx
```

This is the curve volume that must be subtracted.

And the final stored answer is:

```text
343 pi / 6
```

So the important values are present.

### What Went Wrong

The model treated the two main-method rows as if they were two independent choices:

```text
Option 1: use the outer cylinder
Option 2: use the curve integral
```

That is wrong.

They are not alternatives. They are two components of the same volume method:

```text
actual volume = outer cylinder volume - curve volume
```

The genuinely alternative stored method is the washer method:

```text
pi integral [4.5^2 - (1/2 x + 4/x)^2] dx
```

That is mathematically the same as:

```text
outer cylinder volume - curve volume
```

### Is This A Database Error?

Not exactly.

The database is not missing the correct answer or the needed expressions. It also marks the washer route as an alternative-method block.

But the database representation is row-based. It stores mark rows, not a rich semantic method tree saying:

```text
Main method:
  step A: compute outer cylinder
  step B: compute curve volume
  step C: subtract B from A

Alternative method:
  use washer integral directly
```

Because that grouping is not explicit enough, the LLM can misread adjacent mark rows as separate options.

### Fix Applied

Two safeguards were added:

1. Explain mode now says not to turn separate mark rows from the same method into separate options.
2. The source block now labels mixed mark schemes like this:

```text
Main method rows (combine these rows as one method; they are not alternatives)
Alternative method rows (separate valid route)
```

So the model should be less likely to call the cylinder volume and curve volume "two equivalent ways".

## 18. Why Did We Configure Supabase Auth, Redirect URLs, Callback URLs, And Google Cloud?

**Question.** What was the point of enabling password auth and Google auth in Supabase, and why did we also need redirect URLs, callback URLs, and Google Cloud Console?

**Short answer.** We were teaching three systems to trust each other:

```text
Shamo frontend
<-> Supabase Auth
<-> Google
```

Supabase is the account system for Shamo. Google is only one optional way for a user to prove who they are. The redirect/callback URLs are the allowed handoff addresses that keep the login flow from being hijacked.

### The Core Job Of Auth

Before auth, anyone who opened the app was just an anonymous browser.

After auth, the app can say:

```text
This browser belongs to Supabase user abc-123.
The user has verified their email.
The user's current Shamo tier is free, premium, or shamo_student.
```

That matters because tutoring actions are no longer purely public. The app now lets visitors browse papers/questions, but requires a signed-in account before Hint, Explain, Check, or Visualize.

### What Supabase Does

Supabase Auth is Shamo's identity manager.

It handles:

- creating users,
- storing hashed passwords,
- sending confirmation emails,
- accepting Google sign-ins,
- issuing access tokens,
- telling the backend which user is signed in.

In Shamo, the frontend signs in through Supabase and receives a Supabase access token. Then, when the user asks the tutor something, the frontend sends:

```text
Authorization: Bearer <Supabase access token>
```

The backend checks that token with Supabase before it allows `/chat`, `/visualize`, or `/respond`.

### Password Auth Versus Google Auth

Email/password is simple:

```text
User enters email/password
-> Supabase verifies it
-> Supabase returns a session token
-> Shamo uses that token
```

Google auth has one extra participant:

```text
User clicks "Continue with Google"
-> Supabase sends the browser to Google
-> Google asks the user to approve
-> Google sends the browser back to Supabase
-> Supabase creates/updates the user and returns a Shamo session token
```

The important detail: Shamo does not use a Google token as its main app session. Shamo uses the Supabase session. Google is just the identity proof step.

### Regular Email/Password Login In More Detail

When a user signs up with email/password, Supabase creates a user row in its private Auth schema. When the user signs in later, Supabase compares the submitted password with the stored password hash. If it matches, Supabase creates a session.

That session contains two important pieces:

```text
access token  -> short-lived JWT used on API requests
refresh token -> longer-lived token used to get a new access token
```

The frontend sends the access token to Shamo's backend like this:

```text
Authorization: Bearer <Supabase access token>
```

The backend checks that token with Supabase before allowing tutoring actions.

### How Long The JWT Lasts

Supabase's normal/recommended access-token lifetime is 1 hour, unless the project setting is changed in Auth session settings.

The tokens are not permanent tokens created once at signup. A session starts when Supabase actually logs the user in: after password sign-in, after Google OAuth completes, or after an email-confirmation flow returns a valid session. For Shamo's email/password signup flow, a new user may first see "check your email" rather than receiving immediate tutor access.

When the access token expires, the user does not usually get kicked out immediately. The Supabase browser client uses the refresh token to request a fresh access token. So the normal experience is:

```text
access token expires
-> Supabase client refreshes the session
-> new access token is stored
-> user keeps using the app
```

The user is usually asked to log in again only if the refresh token/session is no longer valid, the user signed out, the account changed in a security-sensitive way, or the session lifetime/inactivity rules say the session should end.

### Are The Tokens Always The Same?

No. Access tokens and refresh tokens change over time.

A JWT is not a fixed badge permanently assigned to a user. It is a signed message with claims such as:

```text
user id
session id
issued-at time
expiry time
role/claims
signature
```

The signing secret/key may stay the same, but Supabase can keep issuing new JWTs with new timestamps and expiry values. The signature proves the token came from Supabase and was not edited by the browser.

The refresh token exists so the user does not need to type their password every hour. It is a separate, random, long-lived credential tied to the session. Supabase uses it to issue a fresh short-lived JWT.

Simplified:

```text
password proves identity at login time
refresh token keeps the session alive
access-token JWT proves identity on each API request
```

On sign-out, Supabase removes the session from the browser and revokes refresh tokens so they cannot keep minting new access tokens. An already-issued access-token JWT can still be valid until its short expiry time unless the backend adds an extra live-session check. That is why access tokens are deliberately short-lived.

### Where Passwords Are Stored

Supabase does not store the plain password.

It stores a password hash in:

```text
auth.users.encrypted_password
```

The column name says "encrypted", but the important concept is hashing:

```text
password -> one-way hash
```

Supabase's documented password hashing function is bcrypt. A hash can be checked, but it is not supposed to be reversed back into the original password. That means Shamo should never know or display a user's real password.

The browser cannot directly read this Auth table. Normal Shamo application data belongs in public tables such as `shamo_profiles`; authentication internals belong in Supabase's `auth` schema.

As Admin, you can usually inspect Auth users in the Supabase Dashboard. Supabase also documents that the Auth schema can be viewed in the Table Editor. Treat it as a sensitive internal table: useful for admin/debugging, not something Shamo's frontend should query directly.

### OAuth Client Relationship

For Google login, the Google Cloud OAuth client represents the Shamo application, but Supabase is the service that handles the server-side OAuth exchange.

That is why the setup looks slightly indirect:

```text
Google Cloud OAuth client
-> configured with Supabase callback URL
-> client ID/secret copied into Supabase
-> Shamo frontend calls Supabase
```

The Google Client ID tells Google which app is asking for login. The Google Client Secret lets Supabase securely exchange Google's temporary login code for Google-side proof of identity. That secret must stay in Supabase or another trusted backend, never in Shamo's browser code.

### Why Google Cloud Console Is Needed

Google will not let any random website show a "Sign in with Google" flow.

In Google Cloud Console, we registered Shamo as an app and told Google:

```text
This app is called Shamo.
These browser origins are allowed to start Google login.
This Supabase callback URL is allowed to receive Google's login result.
Here are the client ID and client secret for this app.
```

The Google Client ID is public-ish; it identifies the app. The Google Client Secret is private; it proves to Google/Supabase that this OAuth client setup is legitimate. The secret goes into Supabase, not into the frontend.

### What Is A Callback URL?

A callback URL is where an external provider sends the browser after it finishes its part of the login.

For Google login through Supabase, Google's callback target is Supabase:

```text
https://exjfaggqphjkxniyshfl.supabase.co/auth/v1/callback
```

So the flow is:

```text
1. User clicks Google login in Shamo.
2. Supabase redirects the browser to Google.
3. User signs in with Google.
4. Google redirects back to Supabase's callback URL.
5. Supabase validates the result and creates a Supabase session.
6. Supabase redirects the browser back to Shamo.
```

That callback URL is not the Shamo page. It is Supabase's OAuth receiver.

### What Is A Redirect URL?

A redirect URL is where Supabase is allowed to send the user after auth finishes.

For local Shamo development, examples are:

```text
http://127.0.0.1:5173/chatbot/
http://localhost:5173/chatbot/
```

Supabase needs this allow-list because redirecting after login is security-sensitive. Without an allow-list, an attacker could try to trick Supabase into sending a logged-in user or token-related response to a malicious site.

So:

```text
Callback URL = where Google returns to Supabase.
Redirect URL = where Supabase returns to Shamo.
```

### Why Authorized JavaScript Origins Exist

In Google Cloud, the Authorized JavaScript origins are the browser origins allowed to start the OAuth request.

For local development:

```text
http://127.0.0.1:5173
http://localhost:5173
```

An origin is just:

```text
protocol + host + port
```

It does not include the path. That is why Google gets:

```text
http://127.0.0.1:5173
```

while Supabase redirect URLs can include:

```text
http://127.0.0.1:5173/chatbot/
```

### Why This Protects The App

These settings prevent several bad handoffs:

- a fake app pretending to be Shamo,
- Google sending login results to the wrong receiver,
- Supabase redirecting users to an untrusted website,
- the frontend getting a service-level secret,
- the backend accepting unauthenticated tutor requests.

The browser only gets a publishable Supabase key and a user session token. It never gets the Supabase service-role key or Google Client Secret.

### How This Connects To Shamo Tiers

Authentication answers:

```text
Who is this user?
```

Authorization answers:

```text
What is this user allowed to access?
```

For Shamo:

- signed-in, email-verified user -> Free tier,
- active future Stripe entitlement -> Premium tier,
- active manual Admin entitlement -> Shamo Student tier.

Those tier decisions live in Shamo's database tables, not in Google and not in user-editable profile metadata.

### Simple Mental Model

Think of the whole setup like a checked relay race:

```text
Shamo asks Supabase: please sign this user in.
Supabase asks Google: can you prove this Google user is real?
Google answers Supabase at the callback URL.
Supabase creates a Shamo session.
Supabase redirects the browser back to Shamo.
Shamo sends that Supabase token to the backend.
The backend verifies the token before tutoring.
```

So the point of the setup was not just to make buttons work. It created a trusted login chain that lets Shamo safely know who the student is and later decide which features their tier should unlock.

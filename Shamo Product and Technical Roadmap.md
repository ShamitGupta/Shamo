# Shamo AI Tutor: Current Implementation and Product Roadmap

## Executive summary

Shamo is intended to be an AI mathematics tutor for students studying IGCSE Additional Mathematics and A-level Mathematics. Its key idea is valuable: a student identifies a past-paper question, Shamo retrieves the exact question and official mark scheme, and then explains the solution as a tutor rather than simply giving the final answer.

The current prototype demonstrates this idea, but it is not yet reliable enough for a student-facing product. The main issue is not the choice of database or AI model. The main issue is that the past-paper extraction workflow sometimes stores incomplete or incorrect AI output without checking it first. The current database also stores arbitrary pieces of pages rather than treating each question, question part, mark-scheme item and diagram as a clearly defined record.

The recommended direction is:

1. Keep Supabase.
2. Secure the existing system and stop using the current upload workflow.
3. Design a cleaner version-two question database.
4. Build a small, manually checked collection of papers for testing.
5. Rebuild the extraction workflow so failed papers are held for review rather than published.
6. Reprocess the full collection only after the new workflow is proven reliable.
7. Build similar-question search and student progress tracking on top of the clean question data.
8. Add Desmos and GeoGebra, followed by voice mode.
9. Add generated practice questions and Manim animations after the checking systems are mature.

The goal is not simply to create cleaner text. It is to create a trustworthy and well-organised mathematics question library that every future Shamo feature can reuse.

---

## 1. What Shamo wants to achieve

### Current product goal

Shamo wants to help a student when they are struggling with a particular past-paper question.

A student selects or provides:

- Qualification and subject
- Year
- Examination session
- Paper variant
- Question number
- Their own question or area of confusion

Shamo should then:

1. Find the exact question paper.
2. Find the matching question and mark scheme.
3. Understand what the student is finding difficult.
4. Explain the solution step by step.
5. Use the official mark scheme without merely copying it.
6. Guide the student towards understanding the method.
7. Remember enough of the conversation to answer follow-up questions.

This is a stronger product idea than a general-purpose answer bot because it combines official examination material with personalised tutoring.

### Future product goal

The longer-term vision discussed includes:

- Finding conceptually similar past-paper questions.
- Generating new practice questions in the style of past papers.
- Personalising practice based on each student's mistakes and progress.
- Producing interactive graphs using Desmos.
- Producing geometry and other mathematical constructions using GeoGebra.
- Producing educational animations using Manim.
- Supporting natural spoken conversations through voice mode.
- Remembering a student's strengths, weaknesses and learning history.

Together, these features could turn Shamo from a past-paper assistant into a personalised mathematics tutor.

---

## 2. How Shamo is currently implemented

### Frontend

The frontend is built with React and Vite. It provides:

- A chat interface.
- Dropdowns for selecting past-paper information.
- Mathematical formatting using LaTeX.
- Streaming responses so explanations appear progressively.
- Short-term memory of the most recent 10 messages, or approximately five user-assistant exchanges.

The recent conversation exists only in React memory. It disappears when the page is refreshed or closed. There is no real account-based history yet.

The interface contains authentication screens, but authentication is not yet connected to a working user and permission system.

The frontend currently contains direct links to the old Railway backend. The backend is no longer deployed, so those requests are expected to fail until a new backend is deployed.

### Backend

The backend is built with FastAPI in Python. Its main responsibilities are:

- Receiving the student's question and selected paper information.
- Looking up matching content in Supabase.
- Sending the question, mark scheme and conversation history to OpenAI.
- Streaming the tutoring response back to the frontend.

The current design uses two main requests:

1. `/get_info` finds the past-paper information.
2. `/get_response` asks the AI to produce the tutoring explanation.

The current backend is small and understandable, which is useful for a prototype. However, it needs stronger error handling, security, testing and checking before production use.

### Database

Supabase currently stores extracted past-paper text in two main tables:

- `documents` for IGCSE material.
- `A_level Math` for A-level material.

Each row mainly contains:

- A piece of extracted text.
- An embedding, which is a numerical representation used for meaning-based search.
- A metadata object containing paper information and question numbers.

The tables therefore behave more like collections of page fragments than a carefully organised question library.

### AI use

The current backend uses OpenAI to generate the tutoring response. The ingestion workflow also uses AI to interpret papers and identify the questions appearing on each page.

This is a sensible use of AI, but AI output must be checked before being treated as correct database information.

### Past-paper upload workflow

The supplied n8n workflow performs approximately the following steps:

1. Reads paper links and information from a Google Sheet.
2. Sends each PDF to Mistral OCR.
3. Sends the paper to an OpenAI vision model to identify question numbers by page.
4. Combines the OCR output, spreadsheet information and OpenAI output.
5. Adds image descriptions to the extracted page text.
6. Splits the page text into smaller pieces.
7. Creates embeddings.
8. Inserts the results directly into Supabase.

The source spreadsheet was found to be well organised. It contained 504 unique URLs representing 252 paper identities, with one question paper and one mark scheme for every identity. No important source metadata problem was found. The inaccuracies were introduced later in the extraction and upload workflow.

---

## 3. What the current implementation does well

The prototype already contains several good decisions:

- The business goal is focused on a real student problem.
- The question paper and mark scheme are used together.
- The interface collects exact paper details instead of relying only on free-text guessing.
- Responses are streamed, which improves the experience for long explanations.
- Mathematical formatting is supported.
- Frontend and backend responsibilities are reasonably separated.
- Supabase provides a practical starting point for the database, authentication, files and search.
- The source spreadsheet is clean and can be reused for a better import process.
- Image descriptions are included in many records and are sometimes useful.

These strengths mean Shamo does not need to be restarted from nothing. The product idea and parts of the application can be kept while the data foundation is rebuilt.

---

## 4. Current limitations and risks

### Exact retrieval is not consistently reliable

If a student asks for Question 4, the system performs a database lookup using that number. Some stored records use values such as `4(a)` rather than separating the main question number from the part. This can prevent the matching mark scheme from being returned.

For example, a verified IGCSE mark-scheme row used:

```text
["1", "2", "3", "4(a)"]
```

When the backend searches for the number `4`, this row may not match because `4` and `4(a)` are stored as different values.

### Workflow errors were uploaded as academic data

Some database rows contain values such as:

```text
"Warning: Page 1 not found in formatted_data"
```

This text was created directly by the n8n code when page-to-question information was missing. Instead of stopping the paper and marking it as failed, the workflow continued and uploaded the warning into the question-number field.

The warning records often affect an entire paper, suggesting that the OpenAI output failed to parse or was missing, after which the workflow silently treated the result as an empty object.

### The AI response format was not strictly controlled

The OpenAI extraction step requested JSON in ordinary written instructions but did not enforce a strict output structure. Its example also conflicted slightly with the requested format.

As a result, the model could return:

- Main question numbers.
- Question numbers with parts included.
- Unexpected text.
- A structure that the next step could not parse.

The workflow accepted these differences instead of rejecting or correcting them.

### Workflow branches were joined by position

The OCR output, spreadsheet rows and question-extraction results were combined according to their order. If one branch returned fewer items or changed order, information from different papers could potentially be joined incorrectly.

Each paper should instead receive a stable ID before processing. Every branch should carry that ID, and results should be joined using it.

### Text was split at arbitrary positions

The workflow labels a full page with all question numbers found on that page and then splits the text into smaller pieces. Every resulting piece inherits all the page's question numbers.

This means a text piece about Question 3 may also be labelled as Question 4 if both appear on the same page. Retrieval can therefore return unrelated content.

The paper should first be separated by question and question part, and only then split further if necessary.

### Images are only partly preserved

The written image descriptions improve the situation, but their quality varies. Some are detailed enough to be useful, while others are vague, uncertain or describe only a barcode or blank page.

Examples found included descriptions such as a graph being “likely sine or cosine,” which does not preserve the exact mathematical information needed to solve the question.

The original PDF and cropped question diagrams should be saved alongside their descriptions.

### Database content was publicly readable

The public Supabase role could read full question content and embeddings. This should be corrected before relaunching the application.

Students should access data through approved backend operations or carefully controlled database permissions. Private user data must only be visible to its owner.

### The chatbot can answer without reliable source material

If retrieval finds no matching paper content, the current design may still allow the AI to answer from its general knowledge. This weakens the promise that the response is grounded in the exact paper and mark scheme.

For requests that claim to use a specific past paper, Shamo should clearly state when the source was not found rather than quietly producing an unsupported answer.

### Conversation memory is very limited

Only the recent messages in the current browser session are remembered. There is no saved conversation history, student profile or long-term understanding of the student's weaknesses.

---

## 5. Summary of the database review

The live database review found:

### IGCSE table

- 4,712 rows.
- 84 unique papers.
- Material from 2020 to 2025.
- All paper identities had both a question paper and mark scheme somewhere in the table.
- 1,338 rows had empty question-number tags.
- 440 question-number values were not simple whole numbers.
- 14 of the 84 papers had a mismatch between the question-paper and mark-scheme question sets.

### A-level table

- 15,712 rows.
- 252 unique papers.
- Material from 2020 to 2025.
- 5,385 rows had empty question-number tags.
- 603 question-number values were not simple whole numbers.
- 19 of the 252 papers had a mismatch between the question-paper and mark-scheme question sets.

These numbers do not mean that all affected rows are unusable. Some non-numerical values correctly express parts such as `3(b)(ii)`. The problem is that main numbers and parts are stored together inconsistently, while the backend expects a simpler format.

The database has substantial useful content, but it needs to be reconstructed into a more reliable structure before becoming the foundation for advanced tutoring features.

---

## 6. Should Shamo keep Supabase?

Yes. Shamo should keep Supabase for the foreseeable future.

Supabase can support:

- Past-paper and mark-scheme data.
- Meaning-based and exact-word search.
- Student accounts.
- Conversation history.
- Student progress.
- PDFs, images, audio and rendered videos.
- Database permissions.
- Backups and server-side functions.

The current collection is not large enough to justify moving simply for scale.

Moving to AWS would not correct OCR mistakes, missing question mappings or incorrect upload logic. A comparable AWS setup would probably require several services for the database, file storage, user accounts, processing jobs and monitoring. That would add operating work without addressing the immediate problem.

AWS or another cloud provider can still be used for specialised processing. For example, a separate container service could render Manim animations while Supabase remains the main database.

A full move away from Supabase should only be considered when there is a clear reason, such as:

- A school or institutional customer requires a particular AWS setup.
- A required region or compliance arrangement is unavailable.
- Measured performance testing shows that Supabase cannot meet the load.
- The team already has strong AWS infrastructure experience.
- The product needs network or server control that Supabase cannot provide.

Because Supabase uses PostgreSQL, the core academic data can be kept reasonably portable if normal PostgreSQL tables and migrations are used.

---

## 7. Recommended database structure

The main design rule should be:

> Questions are the primary records. Search chunks and embeddings are secondary records that can be rebuilt.

### Source papers

Store:

- Qualification.
- Subject.
- Syllabus code and syllabus version.
- Year and session.
- Variant.
- Document type.
- Original URL.
- Private PDF location.
- File hash used to detect duplicates.
- Processing and review status.

### Questions

Store:

- Paper ID.
- Whole-number question number.
- Question text.
- Marks.
- Source page and position.
- Extraction confidence.
- Review status.

### Question parts

Store parts separately:

```text
question_number = 4
part = a
subpart = ii
```

This is safer than storing `4(a)(ii)` as one question-number value.

### Mark-scheme items

Connect every marking step to the correct question or question part. Store:

- Expected method.
- Answer.
- Mark code.
- Alternative accepted methods.
- Explanatory notes.

### Diagrams and other images

Store:

- The original cropped image.
- The source page and position.
- Image type, such as graph, geometry diagram, table or decorative item.
- A written description.
- A structured mathematical description where possible.
- Whether it is needed to solve the question.
- Review status.

The `has_images` value should be calculated from these image records rather than entered independently.

### Topics, concepts and skills

Each question can connect to one or more:

- Topics.
- Subtopics.
- Required skills.
- Prerequisite concepts.
- Common mistakes.
- Solution methods.
- Difficulty levels.

For example:

```text
Topic: Quadratics
Skills: Completing the square, discriminant reasoning
Common mistake: Treating the discriminant condition incorrectly
Difficulty: Medium
```

### Search records

The search system should store separate searchable representations for:

- The question statement.
- The solution method.
- The mark scheme.
- The concept and skill information.

Every embedding should record which model created it and which content version it represents. This allows all embeddings to be rebuilt safely when the content or model changes.

### Student learning records

Store:

- Student attempts.
- Answers submitted.
- Hints requested.
- Time spent.
- Mistakes detected.
- Concepts demonstrated.
- Whether a later similar question was solved independently.
- Estimated understanding of each concept.

Private student records must be protected so each student can only access their own information.

### Processing and quality records

Store every import attempt and its outcome:

- Source paper.
- OCR version.
- AI model and prompt version.
- Start and finish time.
- Checks passed and failed.
- Error messages.
- Human reviewer and decision.

This makes it possible to investigate how any database record was created.

---

## 8. A safer past-paper import process

The new workflow should be:

```text
Read source paper
    ↓
Validate its spreadsheet information
    ↓
Give it a stable paper ID
    ↓
Save the original PDF
    ↓
Run OCR and image extraction
    ↓
Extract questions using a strict response format
    ↓
Separate questions, parts, mark schemes and images
    ↓
Run automatic checks
    ↓
Failed: hold for review        Passed: publish
```

### Important changes

#### Process one paper at a time initially

This is slower but easier to debug. Larger batches can be introduced after the process is reliable.

#### Use a stable paper ID everywhere

An example could be:

```text
9709-2025-may-june-31-question-paper
```

Every processing step should carry this ID. Results should never be joined only because they happen to be in the same list position.

#### Require a strict AI response format

The AI should be required to return clearly defined fields with the expected data type. Question numbers must be whole numbers, while parts must be separate text fields.

Unexpected fields or invalid values should cause the paper to fail checking.

#### Do not replace errors with empty data

If parsing fails, the paper must be recorded as failed. The workflow should not replace the missing result with an empty object and continue.

#### Publish only after checking

Checks should include:

- Paper information matches its URL and source sheet.
- All pages were processed or intentionally classified as blank.
- Question numbers are valid whole numbers.
- Parts are stored separately.
- No warning or error text appears in academic fields.
- Question-paper and mark-scheme questions match.
- Important images were saved.
- Required text is not empty.
- The same paper has not already been published.

If an important check fails, nothing from that paper should enter the main question tables.

---

## 9. Finding similar questions

Similarity should not be based only on similar wording.

Two questions may look different but test the same skills. For example, a quadratic inequality, a discriminant problem and a graph-intersection problem can require closely related reasoning.

Shamo should compare:

- Subject and syllabus.
- Topic and concepts.
- Required solution method.
- Difficulty.
- Mark allocation.
- Question structure.
- Use of diagrams or graphs.
- Expected answer format.
- Overall meaning of the question text.

A useful result should explain why it was selected:

> This question is similar because both require completing the square and then reasoning about the discriminant. It is slightly harder because it includes an unknown parameter.

Question text and mark-scheme text should be searched separately. This helps avoid revealing answers when presenting a student with a practice question.

---

## 10. Generating new practice questions

This feature should be described as generating syllabus-based practice rather than predicting future examination questions. Past papers can show common patterns, but they cannot guarantee what an examination board will ask next.

The system should define reusable question plans containing:

- Concepts being tested.
- Intended solution method.
- Target difficulty.
- Number of marks.
- Number of steps.
- Allowed values and mathematical restrictions.
- Expected answer format.
- Diagram requirements.
- Common mistakes the question is designed to expose.

Generated questions must be stored separately from official past-paper questions.

Suggested stages are:

```text
Draft → Automatically checked → Human reviewed → Published
                         ↘ Rejected
```

For each generated question, store:

- Source questions that inspired it.
- Model and prompt version.
- Correct answer.
- Full mark scheme.
- Automatic checking results.
- Similarity to source questions.
- Reviewer decision.

Every generated mathematics question should be independently solved and checked. It should also be compared against existing papers so it is not merely a close copy.

---

## 11. Desmos and GeoGebra

Desmos and GeoGebra should be tools the tutor can choose when a visual explanation would help.

### Desmos is suitable for

- Function graphs.
- Intersections and roots.
- Inequalities.
- Transformations.
- Data and regressions.
- Sliders that let students explore changing values.

### GeoGebra is suitable for

- Geometry constructions.
- Loci.
- Vectors.
- Circle theorems.
- Dynamic proofs.
- Three-dimensional diagrams.

Shamo should produce a clear graph or construction instruction rather than an unstructured paragraph. For example:

```text
Tool: Desmos
Plot: y = x² - 4x + 3
Show: Roots and turning point
Horizontal range: -2 to 6
Purpose: Explain completing the square
```

The database should save:

- Which tool was used.
- The graph or construction instructions.
- Related question and concept.
- Whether the instructions were successfully tested.
- Optional image output.
- A description for accessibility.

Repeated graphs can be reused instead of regenerated.

---

## 12. Manim animations

Manim could create explanations similar in spirit to mathematical educational animations, but it should be added later because it is slower and harder to check.

Good uses include:

- Showing why completing the square works.
- Connecting a moving tangent to differentiation.
- Building an area using integration.
- Demonstrating graph transformations.
- Showing vector addition.
- Developing a geometric proof step by step.

The safe process should be:

```text
Tutor requests animation
    ↓
Create a restricted animation plan
    ↓
Send it to a separate rendering server
    ↓
Render with time and computing limits
    ↓
Check and store the video
    ↓
Show it to the student
```

AI-generated Python should not run freely on Shamo's main server. Animation rendering should happen in an isolated environment.

The first Manim version should use reusable templates such as:

- Animate a graph transformation.
- Animate a tangent moving along a curve.
- Animate a Riemann sum.
- Animate vector addition.

This will be safer and more consistent than generating every animation from scratch.

---

## 13. Voice mode

Voice should be another way of communicating with the same tutor, not a separate tutoring system.

A student might say:

> I do not understand why you completed the square in that step.

The voice system must know:

- Which question is being discussed.
- Which solution step is visible.
- What the student already attempted.
- What Shamo previously explained.

The same tutor should still be able to:

- Retrieve a paper question.
- Find similar questions.
- Display a graph.
- Record an attempt.
- Update the student's learning progress.

The database should store:

- Conversation session.
- Text transcript.
- Speaker.
- Language.
- Related question and solution step.
- Tool requests and results.
- Important learning result.
- Consent and deletion settings.

Raw student audio does not need to be kept by default. The transcript is normally enough. If raw audio is stored for a specific feature, the student should be informed and the recording should have a clear deletion date.

Because many users may be under 18, student privacy and safeguarding should be designed from the beginning rather than added later.

---

## 14. Personalised learning

Long-term student learning data may become Shamo's most valuable feature.

For each attempt, Shamo should record:

- Question attempted.
- Student answer.
- Correctness.
- Hints requested.
- Amount of help needed.
- Time spent.
- Mistake or misconception.
- Concepts demonstrated.
- Result on a later similar question.

This would allow Shamo to provide feedback such as:

> You understand differentiation, but you often forget the chain rule when the inside function is quadratic. Let us practise that specific skill.

This is the difference between a chatbot that answers isolated questions and a tutor that helps a student improve over time.

---

## 15. Recommended order of work

### Phase 0: Immediate protection

1. Rotate the Mistral credential exposed in the n8n export.
2. Review every other API key used by the workflow.
3. Remove anonymous reading of database content and embeddings.
4. Back up the database and original source spreadsheet.
5. Stop the current workflow from writing more records.

### Phase 1: Define reliable academic data

1. Define the new paper, question, part, mark-scheme and image records.
2. Decide the required and optional fields.
3. Define which validation failures prevent publication.
4. Create database migrations so the structure can be reproduced safely.
5. Keep the current tables as read-only legacy data.

### Phase 2: Create a trusted test collection

1. Select approximately 20–30 representative papers.
2. Include IGCSE and A-level papers.
3. Include question papers and mark schemes.
4. Include image-heavy and text-heavy papers.
5. Manually record the correct questions, parts and important images.
6. Use this collection to measure whether the new workflow is correct.

### Phase 3: Rebuild ingestion

1. Save original PDFs and hashes.
2. Process one paper at a time initially.
3. Use a strict AI response structure.
4. Separate question numbers from parts.
5. Save original diagram crops.
6. Stop and quarantine failed papers.
7. Compare question papers with their mark schemes.
8. Make repeated uploads safe and non-duplicating.
9. Produce a quality report for every import run.

### Phase 4: Rebuild basic Shamo

1. Deploy a new backend.
2. Make exact paper and question lookup reliable.
3. Clearly report when a source cannot be found.
4. Prevent students from altering retrieved source content.
5. Add authentication and saved conversations.
6. Add suitable rate limits and error messages.
7. Test tutoring explanations against the trusted paper collection.

### Phase 5: Improve search and learning

1. Add topics, concepts, skills and difficulty.
2. Build similar-question search.
3. Explain why questions are similar.
4. Record student attempts and hints.
5. Build a basic student-strength and weakness profile.
6. Recommend the next useful question.

### Phase 6: Add visual tools

1. Add Desmos for functions, graphs and inequalities.
2. Add GeoGebra for geometry, vectors and three-dimensional work.
3. Validate tool instructions before displaying them.
4. Store and reuse successful visual explanations.

### Phase 7: Add voice

1. Add live speech input and output.
2. Keep text transcripts connected to the same tutor session.
3. Allow voice conversations to use retrieval and graph tools.
4. Add clear privacy, consent and deletion controls.

### Phase 8: Add generated practice and animation

1. Create reusable question plans.
2. Generate new questions separately from official material.
3. Verify every question and answer independently.
4. Add human review before publication.
5. Introduce template-based Manim animations.
6. Add more flexible animations only after the templates prove reliable.

---

## 16. How success should be measured

The following should be treated as minimum quality goals:

- No warning or error messages stored as question information.
- No invalid question numbers.
- No unexplained missing pages.
- No duplicate official questions.
- Every important diagram is preserved.
- Every question can be traced back to its original paper and page.
- Question-paper and mark-scheme differences are reviewed.
- Failed papers never enter the published question library.
- Generated questions are never published without checking.
- Students cannot read another student's private information.
- Shamo clearly states when it cannot find the requested source.

Product quality should also be tested with real student tasks:

- Did Shamo retrieve the exact requested question?
- Did it retrieve the correct mark scheme?
- Was the explanation mathematically correct?
- Did the explanation help without revealing too much too early?
- Could the student solve a similar question afterwards?
- Did Shamo correctly identify the student's misconception?
- Was the response fast enough for a natural conversation?

The most meaningful success measure is not whether the model produced a convincing answer. It is whether the student understood the idea and performed better on the next question.

---

## 17. Final recommendation

Shamo should keep Supabase and concentrate first on data reliability.

The immediate development goal should be:

> Build a trusted version-two question library and prove the new extraction process on a small, manually checked collection of papers.

Once exact retrieval and mark-scheme matching are dependable, the next best feature is similar-question search combined with student progress tracking. That creates the foundation for genuine personalisation.

Desmos, GeoGebra and voice can then be added as new ways for the same tutor to teach. Generated questions and Manim should come later because they require the strongest checking and safety systems.

Following this order avoids building impressive features on unreliable information. It gives Shamo the best chance of becoming a tutor that students can trust.

---

## Useful technical references

- [Supabase database overview](https://supabase.com/docs/guides/database/overview)
- [Supabase hybrid keyword and meaning-based search](https://supabase.com/docs/guides/ai/hybrid-search)
- [Supabase vector indexes](https://supabase.com/docs/guides/ai/vector-indexes)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI voice agents](https://developers.openai.com/api/docs/guides/voice-agents)
- [OpenAI Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Desmos API](https://www.desmos.com/api/v1.11/docs/index.html?lang=en)
- [GeoGebra Apps API](https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/)
- [Manim documentation](https://docs.manim.community/en/stable/)


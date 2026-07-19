# Stanford × DeepMind Hackathon — Project Specifications

> Saved verbatim from the organizer/team spec on 2026-07-19. This is the source of
> truth for submission requirements. See the root `CLAUDE.md` for how it maps onto
> this codebase.

## 1. Core objective

Build and deploy a **working web application** whose primary feature meaningfully uses a **Gemini model**.

The finished product must not merely be coded with Gemini. A person using the deployed application should directly benefit from Gemini's capabilities.

```text
User input
   ↓
Application backend
   ↓
Gemini model
   ↓
Structured or generated result
   ↓
Useful action shown in the product
```

---

## 2. Mandatory requirements

### Gemini integration

* Use an official **Gemini model** through either:
  * **Gemini Developer API**
  * **Google Gen AI SDK**
  * **Vertex AI**
* Gemini must power at least one central product capability.
* The application should clearly disclose what Gemini does.
* The API key must remain on the server and must never appear in frontend code.
* The application should handle Gemini errors, timeouts, and malformed responses.

Strong Gemini use cases include:

* Multimodal image or video understanding
* Document analysis
* Structured data extraction
* Personalized recommendations
* Tool selection and agent reasoning
* Natural-language interfaces
* Classification and prioritization
* Generating plans, reports, explanations, or content
* Comparing multiple sources or alternatives

Using Gemini only for a decorative chatbot would technically demonstrate integration, but it would probably produce a weak submission.

---

## 3. Development environment

### Recommended stack

* **Editor:** VS Code
* **Coding agent:** Cline
* **Version control:** GitHub
* **Frontend:** Next.js with TypeScript
* **UI:** Tailwind CSS
* **Backend:** Next.js API routes or a lightweight Node.js backend
* **Gemini SDK:** `@google/genai`
* **Hosting:** Vercel
* **Optional database:** Supabase, Firebase, or PostgreSQL
* **Optional file storage:** Vercel Blob, Supabase Storage, or Google Cloud Storage

### Acceptable alternatives

* React + Express
* Python + FastAPI
* Replit
* Railway
* Google Cloud Run
* Firebase
* Gemini CLI
* Cursor
* Claude Code or Codex for implementation support

**Google AI Studio is optional.** We may use it only to:

* Generate a Gemini API key
* Test prompts
* Inspect model responses
* Prototype structured outputs

The project itself can remain entirely in VS Code.

---

## 4. Functional requirements

The application must include:

1. **A clear landing page**
   * Product name
   * One-sentence value proposition
   * Visible call to action
   * Brief explanation of the problem

2. **A usable input workflow**
   * Text, image, document, URL, form, or another relevant input
   * Input validation
   * Loading indicator
   * Clear submission action

3. **Gemini-powered processing**
   * Server-side Gemini API call
   * Carefully defined system instructions
   * Relevant contextual data
   * Structured output where practical

4. **A useful result screen**
   * Results presented clearly
   * Important information visually prioritized
   * Ability to retry or modify the input
   * Copy, export, save, or share functionality when relevant

5. **Error handling**
   * Missing input
   * Unsupported file type
   * Gemini API failure
   * Rate limit
   * Timeout
   * Empty or malformed Gemini response

6. **Public deployment**
   * No local-only functionality
   * No login required for judges unless authentication is essential
   * Demo credentials provided when authentication exists
   * Mobile and desktop usability

---

## 5. Gemini implementation requirements

### Model behavior

Gemini should return predictable results rather than uncontrolled prose whenever possible.

Preferred output formats:

* JSON
* Typed objects
* Ranked lists
* Categories with confidence scores
* Action plans
* Extracted fields
* Evidence plus explanation

### Prompt architecture

Use separate layers:

* **System instruction:** Gemini's role and rules
* **User input:** the participant's request
* **Application context:** product-specific facts and constraints
* **Output schema:** required response structure

### Reliability

* Validate Gemini's output before displaying it.
* Fall back gracefully when structured output cannot be parsed.
* Limit the amount of input sent to reduce latency and cost.
* Avoid repeatedly calling Gemini for the same unchanged input.
* Display a progress state during generation.
* Keep the initial response time reasonably short.

---

## 6. Security requirements

* Store `GEMINI_API_KEY` in environment variables.
* Never commit `.env` files.
* Add `.env*` to `.gitignore`.
* Make Gemini requests from the server.
* Sanitize user input before rendering it.
* Validate uploaded file types and sizes.
* Avoid exposing stack traces or secret configuration.
* Do not store sensitive data unless the product genuinely requires it.
* Add basic rate limiting when practical.

---

## 7. User-experience requirements

Because judges may spend only a few minutes on each product:

* The core feature should be understandable within **10 seconds**.
* The first successful Gemini result should require no more than a few actions.
* Include at least one preloaded example.
* Avoid mandatory onboarding.
* Avoid large forms.
* Avoid unfinished navigation items.
* Avoid features that cannot be demonstrated reliably.
* Use realistic sample content rather than placeholder text.
* Make Gemini's contribution visibly obvious.

A strong demo flow should resemble:

```text
Open app
   ↓
Understand value immediately
   ↓
Choose sample or provide input
   ↓
Press one primary button
   ↓
Gemini processes the request
   ↓
Receive a polished, useful result
```

---

## 8. Scope requirements for a solo hackathon

### Must have

* One polished primary workflow
* One real Gemini-powered capability
* Public deployment
* Clean interface
* Stable demo path
* Submission materials

### Nice to have

* User history
* Authentication
* Database persistence
* Sharing
* Multiple Gemini modes
* Analytics
* Advanced animations
* Payments
* Collaborative functionality

### Explicitly avoid unless central to the idea

* Building a full social network
* Complex account systems
* Native mobile applications
* Training a custom model
* Large data pipelines
* Multiple unrelated features
* Infrastructure that cannot be finished within the event

The winning strategy is generally:

> **One painful problem, one impressive Gemini interaction, one polished demo.**

---

## 9. Submission deliverables

Prepare the following even before the official submission form appears:

* **Public application URL**
* **GitHub repository**
* **Product name**
* **One-sentence pitch**
* **Problem statement**
* **Target user**
* **Explanation of Gemini usage**
* **Technology stack**
* **Two-minute pitch video**
* **Approximately one-minute product demonstration**
* **Brief description of business potential**
* **Team information**, identifying the project as a solo submission
* **Screenshots** of the finished product
* **Demo credentials**, when required

---

## 10. Repository requirements

Recommended structure:

```text
README
├── Product overview
├── Problem
├── Solution
├── Gemini integration
├── Architecture
├── Local setup
├── Environment variables
├── Deployment
└── Demo link
```

The repository should also include:

* Clear installation instructions
* Example environment-variable names
* No exposed credentials
* A working default branch
* Meaningful commit history
* License when appropriate
* Screenshots or animated demo
* A note describing exactly where Gemini is used

---

## 11. Pitch requirements

The pitch should answer five questions quickly:

1. **What problem exists?**
2. **Who experiences it?**
3. **What does the product do?**
4. **Why is Gemini necessary?**
5. **Why could this become a meaningful business?**

A strong pitch format:

> **[Product] helps [specific user] accomplish [valuable outcome] by using Gemini to [distinctive capability], reducing [current pain, cost, or delay].**

---

## 12. Definition of done

The project is complete when:

* The deployed URL opens successfully.
* The central workflow works without local setup.
* Gemini receives real input and produces a meaningful result.
* The result is presented in a polished format.
* No API keys are exposed.
* The app has a reliable sample demonstration.
* The README explains the Gemini integration.
* The repository is public or accessible to judges.
* The pitch and demo videos are uploaded.
* All submission links are tested in an incognito browser.

---

## Open decisions

Two decisions will determine the next specification:

1. **What exact problem are we building around?**
2. **Should we use Next.js on Vercel, or Replit for the fastest possible deployment?**

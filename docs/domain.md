# CalDone

CalDone turns captured food into a nutrition record and lets the user inspect or change that record directly or through an AI assistant.

## Language

**Meal**:
A dated record of food, its photos and notes, and the resulting editable nutrition estimate.
The capture note belongs to the user. Agent edits preserve it verbatim. The separate AI comment holds a concise assistant-authored explanation, such as an estimated oil quantity or a limitation of the photo. It can exist before a nutrition estimate, is visible in the meal card, and is included in backups and action snapshots. Omitting a comment in an edit preserves it; an empty comment removes it. Corrections should update or clear assumptions they invalidate; a comment never replaces nutrition items or question answers.
_Avoid_: Check, entry, food log

**Meal History**:
The user's collection of meals across dates.
_Avoid_: Timeline, archive

**Goal**:
A user-controlled daily nutrition target used as a reference rather than a grade or medical prescription.
_Avoid_: Limit, allowance

**CalDone Assistant**:
The in-app AI conversation that can discuss general topics and use CalDone tools to read or change the user's data.
_Avoid_: Bot, nutritionist, general AI

**CalDone Tool**:
An explicitly defined operation through which the CalDone Assistant can read or change app-owned data.
_Avoid_: Plugin, function, capability

**Requested Change**:
A change to CalDone data that the user asks the CalDone Assistant to make, including a direct or indirect answer to an open clarification about that fact. Discussion alone does not authorize a change.
_Avoid_: Suggestion, inferred change


**Meal Conversation**:
The persistent primary conversation that starts with a meal capture and carries later forms, ordinary messages, additions and corrections. Legacy secondary conversations can still refer to the same meal.

**Question**:
A durable clarification with a stable ID, an owning meal or general conversation, and an explicit open, answered or dismissed state. An uncertain answer is recorded as uncertain. Sending an unrelated message never closes it.

**Agent Turn**:
One accepted user input and the resulting sequence of provider requests and tool operations. Input is persisted before inference. Navigation observes a turn; cancellation and process recovery belong to its conversation.
Visible activity follows the running operation across chat, meal detail and history. A submitted form stops accepting duplicate input once its answer is persisted, while unresolved questions remain durable until the agent resolves them.

**Meal Edit**:
An atomic change to meal details, nutrition, or relevant question states, with a matching Undo snapshot and a replay receipt. An edit can update or clear only the AI comment, including before a nutrition estimate exists. A repeated tool call cannot apply the same edit twice.

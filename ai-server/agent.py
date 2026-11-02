"""Agentic RAG layer — a LangGraph agent that *decides* how to search the tone
dataset before composing a preset.

Unlike the plain /suggest path (one retrieval → one generation), here an LLM with
a `search_tones` tool drives retrieval itself: it can reformulate a vague request
("something dreamy") into better queries ("ambient clean reverb"), search more
than once, and judge the candidates — then a final step turns the gathered
references into the strict preset JSON.

    user prompt → [agent] ⇄ [search_tones]  → [compose JSON] → END
                  reason & retrieve            grounded output
"""

import json
from langchain_ollama import ChatOllama
from langchain_core.tools import tool
from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.prebuilt import ToolNode

AGENT_SYSTEM = (
    "You are a guitar-tone research assistant. Given the user's request, call the "
    "search_tones tool to find reference tones from a verified dataset. You may call "
    "it more than once, reformulating the query — translate a vibe ('dreamy', 'angry') "
    "into concrete terms ('ambient clean reverb', 'high-gain metal') — to get better "
    "matches. Once you have good references, stop and reply with a one-line note. "
    "Do NOT write the final amp/effects settings yourself; that is done afterwards."
)

# Compiled graphs are cached per model so we don't rebuild on every request.
_AGENTS: dict = {}


def _format_hit(entry: dict, score: float) -> str:
    return (
        f"- {entry.get('song')} — {entry.get('artist')} "
        f"({entry.get('genre')}, {entry.get('tone_type')}; match {score:.2f})\n"
        f"  amp_settings: {json.dumps(entry.get('amp_settings', {}))}\n"
        f"  effects: {json.dumps(entry.get('effects', []))}"
    )


def build_agent(model: str, retrieve_tones, system_dataset: str, system_ai: str):
    """Compile the LangGraph agent for a given Ollama model."""

    @tool
    def search_tones(query: str) -> str:
        """Search the verified guitar-tone dataset for tones matching a description —
        a genre, artist, song, or feel (e.g. 'warm blues lead', 'Nirvana grunge').
        Returns the top reference tones with their amp settings and effects."""
        hits = retrieve_tones(query, k=3)
        if not hits:
            return "No matching tones found in the dataset."
        return "Matches:\n" + "\n".join(_format_hit(e, s) for e, s in hits)

    llm_with_tools = ChatOllama(model=model, temperature=0.2).bind_tools([search_tones])

    def agent_node(state: MessagesState):
        return {"messages": [llm_with_tools.invoke(state["messages"])]}

    def should_continue(state: MessagesState):
        last = state["messages"][-1]
        return "tools" if getattr(last, "tool_calls", None) else "compose"

    def compose_node(state: MessagesState):
        msgs = state["messages"]
        user = next((m.content for m in msgs if isinstance(m, HumanMessage)), "")
        refs = "\n\n".join(m.content for m in msgs if isinstance(m, ToolMessage)).strip()
        system = system_dataset if refs else system_ai
        human = (
            f"Request: {user}\n\n"
            f"Reference tones found by search:\n{refs or '(none — use your own knowledge)'}"
        )
        composer = ChatOllama(model=model, temperature=0.7, num_predict=2048, format="json")
        resp = composer.invoke([SystemMessage(content=system), HumanMessage(content=human)])
        return {"messages": [resp]}

    g = StateGraph(MessagesState)
    g.add_node("agent", agent_node)
    g.add_node("tools", ToolNode([search_tones]))
    g.add_node("compose", compose_node)
    g.set_entry_point("agent")
    g.add_conditional_edges("agent", should_continue, {"tools": "tools", "compose": "compose"})
    g.add_edge("tools", "agent")
    g.add_edge("compose", END)
    return g.compile()


async def run_agent(prompt: str, model: str, retrieve_tones, system_dataset: str,
                    system_ai: str, extract_json) -> dict:
    """Run the agentic pipeline and return the parsed preset JSON."""
    graph = _AGENTS.get(model)
    if graph is None:
        graph = _AGENTS[model] = build_agent(model, retrieve_tones, system_dataset, system_ai)
    state = {"messages": [SystemMessage(content=AGENT_SYSTEM), HumanMessage(content=prompt)]}
    # recursion_limit caps the tool-calling loop so a confused model can't spin forever.
    final = await graph.ainvoke(state, {"recursion_limit": 8})
    return extract_json(final["messages"][-1].content)

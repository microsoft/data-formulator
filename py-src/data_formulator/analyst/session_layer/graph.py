"""The thread graph, ported from ``src/app/threadGraph.ts`` (design-docs/58).

Items (tables, loaded tables, files, reports, workflow definitions, artifact sets)
and messages (turns, drafts) are nodes with one parent link. Threads follow the
oldest follower at each step; other followers start branch threads. Shared fixtures
(tests/fixtures/session_layer/threads.json) keep this and the TypeScript in step.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any, Callable, Iterable

CONVERSATION_ROOT_PREFIX = "conversation-root:"
ITEM_KINDS = frozenset({"table", "loaded-table", "file", "report", "workflow-definition", "artifact-set"})


def conversation_root_id(id: str) -> str:
    return f"{CONVERSATION_ROOT_PREFIX}{id}"


def is_conversation_root_id(id: str | None) -> bool:
    return bool(id) and id.startswith(CONVERSATION_ROOT_PREFIX)


@dataclass(frozen=True)
class Node:
    id: str
    kind: str
    parent_id: str | None
    created_at: float
    set_id: str | None = None
    table_id: str | None = None


@dataclass
class Thread:
    key: str
    root_id: str
    branch_from_id: str | None
    node_ids: list[str] = field(default_factory=list)


def _items(values: Any) -> Iterable[dict[str, Any]]:
    return (item for item in values or [] if isinstance(item, dict) and isinstance(item.get("id"), str))


class ThreadGraph:
    def __init__(self, *, tables=(), turns=(), drafts=(), loaded_nodes=(), file_nodes=(), reports=(), artifact_sets=()):
        nodes: dict[str, Node] = {}
        order: dict[str, int] = {}
        counter = iter(range(1 << 62))
        self._members: dict[str, list[str]] = {}

        def add(kind: str, item: dict[str, Any], parent: str | None = None, **extra: Any) -> None:
            parent = item.get("parentNodeId") if parent is None else parent
            nodes[item["id"]] = Node(item["id"], kind, parent or None, float(item.get("createdAt") or 0), **extra)
            order[item["id"]] = next(counter)

        # A derived table without an authored edge predates design-docs/42; its trigger stands in.
        for table in _items(tables):
            trigger = ((table.get("derive") or {}).get("trigger") or {}).get("tableId")
            add("table", table, table.get("parentNodeId") or trigger or "")
        for turn in _items(turns):
            add("workflow-definition" if (turn.get("form") or {}).get("kind") == "workflow" else "turn", turn)
        for draft in _items(drafts):
            add("draft", draft)
        for node in _items(loaded_nodes):
            add("loaded-table", node, table_id=node.get("tableId"))
        for file in _items(file_nodes):
            add("file", file)
        for report in _items(reports):
            add("report", report)
        for artifact_set in _items(artifact_sets):
            add("artifact-set", artifact_set)
            member_ids = [id for id in artifact_set.get("memberIds") or [] if isinstance(id, str)]
            self._members[artifact_set["id"]] = [id for id in member_ids if id in nodes]
            for id in member_ids:
                if id in nodes:
                    nodes[id] = replace(nodes[id], set_id=artifact_set["id"], parent_id=artifact_set["id"])

        # A parent cycle has no start: cut each at its oldest node, which then starts the conversation.
        settled: set[str] = set()
        for start in list(nodes):
            path: list[str] = []
            on_path: set[str] = set()
            current: str | None = start
            while current and current in nodes and current not in settled and current not in on_path:
                path.append(current)
                on_path.add(current)
                current = nodes[current].parent_id
            if current and current in on_path:
                cycle = [nodes[id] for id in path[path.index(current):]]
                oldest = cycle[0]
                for candidate in cycle[1:]:
                    if candidate.created_at < oldest.created_at or (
                            candidate.created_at == oldest.created_at and order[candidate.id] < order[oldest.id]):
                        oldest = candidate
                nodes[oldest.id] = replace(oldest, parent_id=conversation_root_id(oldest.id))
            settled.update(path)

        self.nodes = nodes
        self._children: dict[str, list[Node]] = {}
        for node in nodes.values():
            if node.parent_id:
                self._children.setdefault(node.parent_id, []).append(node)
        for children in self._children.values():
            children.sort(key=lambda node: (node.created_at, order[node.id]))

    @classmethod
    def from_state(cls, state: dict[str, Any]) -> "ThreadGraph":
        return cls(
            tables=[*state.get("inputTables", []), *state.get("derivedTables", [])],
            turns=state.get("textTurns"), drafts=state.get("draftNodes"),
            loaded_nodes=state.get("loadedTableNodes"), file_nodes=state.get("fileNodes"),
            reports=state.get("generatedReports"), artifact_sets=state.get("artifactSets"),
        )

    def kind_of(self, id: str | None) -> str | None:
        return self.nodes[id].kind if id in self.nodes else None

    def parent_of(self, id: str | None) -> str | None:
        return self.nodes[id].parent_id if id in self.nodes else None

    def is_item(self, id: str | None) -> bool:
        return self.kind_of(id) in ITEM_KINDS

    def is_message(self, id: str | None) -> bool:
        return self.kind_of(id) in ("turn", "draft")

    def children_of(self, id: str) -> list[Node]:
        return self._children.get(id, [])

    def followers_of(self, id: str) -> list[Node]:
        return [node for node in self.children_of(id) if node.set_id != id]

    def members_of(self, set_id: str) -> list[str]:
        return self._members.get(set_id, [])

    def ancestors(self, id: str | None, include_self: bool = False) -> list[str]:
        chain: list[str] = []
        seen: set[str] = set()
        current = id
        if current and not include_self:
            seen.add(current)
            current = self.parent_of(current)
        while current and current not in seen:
            seen.add(current)
            chain.append(current)
            current = self.parent_of(current)
        return chain

    def nearest_item(self, id: str | None, include_self: bool = True) -> str | None:
        return next((current for current in self.ancestors(id, include_self) if self.is_item(current)), None)

    def table_of(self, id: str | None) -> str | None:
        for current in self.ancestors(id, include_self=True):
            node = self.nodes.get(current)
            if node is None:
                continue
            if node.kind == "table":
                return current
            if node.kind == "loaded-table":
                return node.table_id
            if node.kind == "artifact-set":
                for member_id in self.members_of(current):
                    member = self.nodes.get(member_id)
                    if member and member.kind in ("table", "loaded-table"):
                        return member.id if member.kind == "table" else member.table_id
        return None


def build_threads(graph: ThreadGraph, include_start: Callable[[str], bool] = lambda id: True) -> list[Thread]:
    starts: list[tuple[str, float, str]] = []
    virtual_roots: dict[str, list[Node]] = {}
    for node in graph.nodes.values():
        if node.set_id:
            continue
        if not node.parent_id:
            starts.append((node.id, node.created_at, node.id))
        elif is_conversation_root_id(node.parent_id) or node.parent_id not in graph.nodes:
            virtual_roots.setdefault(node.parent_id, []).append(node)
    threads: list[Thread] = []
    visited: set[str] = set()

    def walk(start_id: str, root_id: str, branch_from_id: str | None = None) -> None:
        if start_id in visited:
            return
        thread = Thread(f"thread-{start_id}", root_id, branch_from_id)
        branches: list[tuple[str, str]] = []
        current: str | None = start_id
        while current and current not in visited:
            visited.add(current)
            thread.node_ids.append(current)
            followers = graph.followers_of(current)
            branches.extend((follower.id, current) for follower in followers[1:])
            current = followers[0].id if followers else None
        threads.append(thread)
        for id, origin in branches:
            walk(id, root_id, origin)

    for root_id, nodes in virtual_roots.items():
        ordered = sorted(nodes, key=lambda node: node.created_at)
        starts.extend((node.id, node.created_at, root_id) for node in ordered)
    starts.sort(key=lambda start: start[1])
    for id, _, root_id in starts:
        if include_start(id):
            walk(id, root_id)
    return threads

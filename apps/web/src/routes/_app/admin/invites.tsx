import { createFileRoute } from "@tanstack/react-router";

import { getInviteTree } from "../../../server/functions/moderation";

export const Route = createFileRoute("/_app/admin/invites")({
  loader: async () => ({ tree: await getInviteTree() }),
  component: InviteTree,
});

interface TreeNode {
  id: string;
  displayName: string;
  email: string;
  children: TreeNode[];
}

function TreeList({ nodes }: { nodes: TreeNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 border-l border-border pl-4">
      {nodes.map((node) => (
        <li key={node.id}>
          <p className="text-sm">
            {node.displayName} <span className="text-muted-foreground">({node.email})</span>
          </p>
          <TreeList nodes={node.children} />
        </li>
      ))}
    </ul>
  );
}

function InviteTree() {
  const { tree } = Route.useLoaderData();
  return <TreeList nodes={tree} />;
}

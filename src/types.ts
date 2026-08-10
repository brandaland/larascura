export type NodeKind =
  | 'route'
  | 'middleware'
  | 'controller'
  | 'service'
  | 'repository'
  | 'model'
  | 'job'
  | 'event'
  | 'listener'
  | 'provider'
  | 'command'
  | 'class';

export type RelationKind =
  | 'handles'
  | 'middleware'
  | 'injects'
  | 'calls'
  | 'dispatches'
  | 'fires'
  | 'listens'
  | 'relates'
  | 'binds';

export interface SourceLocation {
  file: string;
  line: number;
  preview?: string;
}

export interface ArchitectureNode {
  id: string;
  label: string;
  qualifiedName?: string;
  kind: NodeKind;
  location: SourceLocation;
  summary: string;
  syntax: string;
}

export interface ArchitectureEdge {
  id: string;
  source: string;
  target: string;
  kind: RelationKind;
  label: string;
  location: SourceLocation;
  explanation: string;
  confidence: 'exact' | 'inferred';
}

export interface ArchitectureGraph {
  projectName: string;
  root: string;
  generatedAt: string;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  warnings: string[];
}

export interface ParsedClass {
  qualifiedName: string;
  shortName: string;
  kind: Exclude<NodeKind, 'route' | 'middleware'>;
  line: number;
  dependencies: Array<{ type: string; variable: string; line: number }>;
  relations: Array<{ type: string; target: string; line: number }>;
  dispatches: Array<{ type: 'job' | 'event'; target: string; line: number }>;
  bindings: Array<{ abstract: string; concrete: string; line: number }>;
}

export interface ParsedRoute {
  method: string;
  uri: string;
  controller?: string;
  action?: string;
  middleware: string[];
  line: number;
}

// Minimal VS Code API mock for Jest tests
import { EventEmitter as NodeEventEmitter } from 'events';

class MockEventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  readonly event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T): void {
    this.listeners.forEach(l => l(data));
  }
  dispose(): void {
    this.listeners = [];
  }
}

class MockTreeItem {
  label: string;
  collapsibleState: number;
  iconPath?: unknown;
  description?: string;
  tooltip?: unknown;
  command?: unknown;
  contextValue?: string;

  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState ?? 0;
  }
}

class MockThemeIcon {
  constructor(public readonly id: string) {}
}

class MockMarkdownString {
  constructor(public readonly value: string) {}
}

class MockUri {
  static joinPath(base: MockUri, ...segments: string[]): MockUri {
    return new MockUri();
  }
  get fsPath(): string { return '/mock/path'; }
}

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2
} as const;

const ViewColumn = { One: 1, Two: 2, Three: 3 } as const;
const ProgressLocation = { Notification: 15, Window: 10, SourceControl: 1 } as const;

const window = {
  showInformationMessage: jest.fn().mockResolvedValue(undefined),
  showWarningMessage: jest.fn().mockResolvedValue(undefined),
  showErrorMessage: jest.fn().mockResolvedValue(undefined),
  showInputBox: jest.fn().mockResolvedValue(''),
  createTreeView: jest.fn().mockReturnValue({ dispose: jest.fn(), reveal: jest.fn() }),
  createWebviewPanel: jest.fn().mockReturnValue({
    webview: {
      html: '',
      onDidReceiveMessage: jest.fn().mockReturnValue({ dispose: jest.fn() }),
      postMessage: jest.fn()
    },
    onDidDispose: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    reveal: jest.fn(),
    dispose: jest.fn(),
    title: ''
  }),
  withProgress: jest.fn().mockImplementation((_opts: unknown, task: () => Promise<void>) => task()),
  setStatusBarMessage: jest.fn().mockReturnValue({ dispose: jest.fn() })
};

const workspace = {
  getConfiguration: jest.fn().mockReturnValue({
    get: jest.fn().mockReturnValue({})
  })
};

const commands = {
  registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  executeCommand: jest.fn().mockResolvedValue(undefined)
};

const vscode = {
  EventEmitter: MockEventEmitter,
  TreeItem: MockTreeItem,
  ThemeIcon: MockThemeIcon,
  MarkdownString: MockMarkdownString,
  Uri: MockUri,
  TreeItemCollapsibleState,
  ViewColumn,
  ProgressLocation,
  window,
  workspace,
  commands
};

module.exports = vscode;

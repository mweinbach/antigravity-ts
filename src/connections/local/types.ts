import * as os from 'os';

export class RunCommandResult {
  constructor(public output: string = '') {}

  toString(): string {
    return this.output;
  }
}

export class ListDirectoryEntry {
  constructor(
    public name: string,
    public is_directory: boolean = false,
    public file_size: number = 0
  ) {}
}

export class ListDirectoryResult {
  constructor(public entries: ListDirectoryEntry[] = []) {}

  toString(): string {
    const parts = this.entries.map((e) => {
      if (e.is_directory) {
        return `${e.name}/ (dir)`;
      } else {
        return `${e.name} (${e.file_size} bytes)`;
      }
    });
    return parts.join(os.EOL);
  }
}

export class SearchDirectoryResult {
  constructor(public num_results: number = 0) {}

  toString(): string {
    return `${this.num_results} results`;
  }
}

export class FindFileResult {
  constructor(public output: string = '') {}

  toString(): string {
    return this.output;
  }
}

export class EditFileResult {
  constructor(public summary: string = '') {}

  toString(): string {
    return this.summary;
  }
}

export class GenerateImageResult {
  constructor(public image_name: string = '') {}

  toString(): string {
    return this.image_name;
  }
}

export class TextResult {
  constructor(public text: string = '') {}

  toString(): string {
    return this.text;
  }
}

export type ToolOutput =
  | RunCommandResult
  | ListDirectoryResult
  | SearchDirectoryResult
  | FindFileResult
  | EditFileResult
  | GenerateImageResult
  | TextResult;

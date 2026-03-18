export interface IFileAdapter {
  access(filePath: string): Promise<void>;
  readdir(dirPath: string, options?: any): Promise<any[]>;
  readFile(filePath: string, encoding: string): Promise<string>;
  writeFile(filePath: string, content: string, encoding: string): Promise<void>;
  mkdir(dirPath: string, options?: any): Promise<void>;
  rm(targetPath: string, options?: any): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

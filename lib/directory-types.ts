export interface DirectoryUser {
  id: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  middleName: string;
}

export interface DirectorySearchResponse {
  users: DirectoryUser[];
  totalMatches: number;
  total: number;
  loadedAt: string;
  stale: boolean;
}

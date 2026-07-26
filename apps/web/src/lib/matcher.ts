export type MatchSuggestion = {
  resourceId: string;
  externalId: string;
  projectId: string;
  projectSlug: string;
  basis: 'repository' | 'name';
};

type RepositoryResource = {
  id: string;
  externalId: string;
  name: string;
};

type RepositoryProject = {
  id: string;
  slug: string;
  repository: string | null;
};

function normalized(value: string): string {
  return value.toLowerCase();
}

export function suggestMatches(
  repos: RepositoryResource[],
  projects: RepositoryProject[],
): MatchSuggestion[] {
  const suggestions: MatchSuggestion[] = [];
  const usedResourceIds = new Set<string>();

  for (const project of projects) {
    if (project.repository === null) continue;

    const repository = normalized(project.repository);
    const resource = repos.find(
      (candidate) => (
        !usedResourceIds.has(candidate.id)
        && normalized(candidate.externalId) === repository
      ),
    );
    if (!resource) continue;

    usedResourceIds.add(resource.id);
    suggestions.push({
      resourceId: resource.id,
      externalId: resource.externalId,
      projectId: project.id,
      projectSlug: project.slug,
      basis: 'repository',
    });
  }

  for (const project of projects) {
    if (project.repository !== null) continue;

    const slug = normalized(project.slug);
    const resource = repos.find(
      (candidate) => (
        !usedResourceIds.has(candidate.id)
        && normalized(candidate.name) === slug
      ),
    );
    if (!resource) continue;

    usedResourceIds.add(resource.id);
    suggestions.push({
      resourceId: resource.id,
      externalId: resource.externalId,
      projectId: project.id,
      projectSlug: project.slug,
      basis: 'name',
    });
  }

  return suggestions;
}

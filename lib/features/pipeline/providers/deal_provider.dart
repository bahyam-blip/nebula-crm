// Re-export deal providers from contacts so they have a clear home in
// the pipeline feature module. (Direct re-export — no extra code needed.)
export '../../contacts/providers/contact_provider.dart'
    show
        dealByIdProvider,
        dealActivitiesProvider,
        dealsProvider,
        dealsByStageProvider,
        pipelineSummaryProvider;

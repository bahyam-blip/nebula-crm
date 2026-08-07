import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../../../core/services/firestore_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../models/ticket.dart';

final articlesProvider = StreamProvider<List<Article>>((ref) {
  final db = ref.watch(firestoreServiceProvider);
  return db.watchArticles();
});

final articleSearchProvider = StateProvider<String>((ref) => '');

final filteredArticlesProvider = Provider<List<Article>>((ref) {
  final all = ref.watch(articlesProvider).valueOrNull ?? [];
  final q = ref.watch(articleSearchProvider).trim().toLowerCase();
  if (q.isEmpty) return all;
  return all.where((a) {
    return a.title.toLowerCase().contains(q) ||
        (a.summary?.toLowerCase().contains(q) ?? false) ||
        a.tags.any((t) => t.toLowerCase().contains(q));
  }).toList();
});

class KnowledgeBaseScreen extends ConsumerWidget {
  const KnowledgeBaseScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final articles = ref.watch(articlesProvider);
    final search = ref.watch(articleSearchProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Knowledge Base')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              onChanged: (v) =>
                  ref.read(articleSearchProvider.notifier).state = v,
              decoration: InputDecoration(
                hintText: 'Search articles',
                prefixIcon:
                    const Icon(PhosphorIconsRegular.magnifyingGlass, size: 18),
                suffixIcon: search.isNotEmpty
                    ? IconButton(
                        icon: const Icon(PhosphorIconsRegular.x, size: 18),
                        onPressed: () => ref
                            .read(articleSearchProvider.notifier)
                            .state = '',
                      )
                    : null,
              ),
            ),
          ),
          Expanded(
            child: articles.when(
              data: (all) {
                final q = search.trim().toLowerCase();
                final list = q.isEmpty
                    ? all
                    : all.where((a) {
                        return a.title.toLowerCase().contains(q) ||
                            (a.summary?.toLowerCase().contains(q) ?? false) ||
                            a.tags.any((t) => t.toLowerCase().contains(q));
                      }).toList();
                if (list.isEmpty) {
                  return const EmptyState(
                    icon: PhosphorIconsRegular.books,
                    title: 'No articles',
                    subtitle:
                        'Knowledge base articles will appear here once published.',
                  );
                }
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  itemCount: list.length,
                  separatorBuilder: (_, __) =>
                      const Divider(height: 1, indent: 16),
                  itemBuilder: (_, i) {
                    final a = list[i];
                    return _ArticleTile(article: a);
                  },
                );
              },
              loading: () => const Center(
                  child: CircularProgressIndicator(strokeWidth: 2)),
              error: (e, _) => ErrorState(message: 'Failed: $e'),
            ),
          ),
        ],
      ),
    );
  }
}

class _ArticleTile extends StatelessWidget {
  const _ArticleTile({required this.article});
  final Article article;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: AppColors.tertiary.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(PhosphorIconsRegular.fileText,
            color: AppColors.tertiary, size: 18),
      ),
      title: Text(
        article.title,
        style: context.textTheme.titleSmall,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (article.summary != null) ...[
            const SizedBox(height: 2),
            Text(
              article.summary!,
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: 6),
          Row(
            children: [
              if (article.category != null)
                Text(
                  article.category!,
                  style: context.textTheme.labelSmall,
                ),
              if (article.category != null && article.views > 0)
                const Text(' · '),
              if (article.views > 0) ...[
                Icon(PhosphorIconsRegular.eye,
                    size: 10, color: AppColors.textTertiary),
                const SizedBox(width: 3),
                Text(
                  Formatters.compact(article.views),
                  style: context.textTheme.labelSmall,
                ),
              ],
              if (article.helpfulRate > 0) ...[
                const Text(' · '),
                Icon(PhosphorIconsRegular.thumbsUp,
                    size: 10, color: AppColors.success),
                const SizedBox(width: 3),
                Text(
                  Formatters.percent(article.helpfulRate, decimals: 0),
                  style: context.textTheme.labelSmall,
                ),
              ],
            ],
          ),
        ],
      ),
      onTap: () => _openArticle(context, article),
    );
  }

  void _openArticle(BuildContext context, Article a) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => _ArticleDetailScreen(article: a),
      ),
    );
  }
}

class _ArticleDetailScreen extends StatelessWidget {
  const _ArticleDetailScreen({required this.article});
  final Article article;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(article.category ?? 'Article'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(article.title, style: context.textTheme.headlineSmall),
          const SizedBox(height: 8),
          Row(
            children: [
              if (article.authorName != null) ...[
                CircleAvatar(
                  radius: 12,
                  backgroundColor: AppColors.primary.withValues(alpha: 0.2),
                  child: Text(
                    article.authorName!.initials,
                    style: context.textTheme.labelSmall
                        ?.copyWith(color: AppColors.primary),
                  ),
                ),
                const SizedBox(width: 6),
                Text(article.authorName!,
                    style: context.textTheme.labelSmall),
              ],
              if (article.updatedAt != null) ...[
                const SizedBox(width: 12),
                Text(
                  'Updated ${Formatters.timeAgo(article.updatedAt!)}',
                  style: context.textTheme.labelSmall,
                ),
              ],
            ],
          ),
          const SizedBox(height: 24),
          if (article.summary != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: AppColors.primary.withValues(alpha: 0.3),
                ),
              ),
              child: Text(article.summary!,
                  style: context.textTheme.bodyMedium),
            ),
            const SizedBox(height: 20),
          ],
          Text(article.body, style: context.textTheme.bodyLarge),
          const SizedBox(height: 32),
          if (article.tags.isNotEmpty) ...[
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final t in article.tags)
                  Chip(
                    label: Text(t),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

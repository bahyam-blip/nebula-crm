import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/firestore_service.dart';
import '../../auth/providers/auth_provider.dart';

/// A note or an attached document.
///
/// One collection serves both: a note is a note with no file, a document is
/// a note carrying a URL. That keeps the customer timeline in a single
/// ordered stream instead of interleaving two sources at render time.
class CrmNote {
  const CrmNote({
    required this.id,
    required this.body,
    required this.teamId,
    this.parentType = 'contact',
    this.parentId = '',
    this.authorId = '',
    this.authorName = '',
    this.fileUrl,
    this.fileName,
    this.fileSize = 0,
    this.pinned = false,
    this.createdAt,
  });

  final String id;
  final String body;
  final String teamId;

  /// contact | company | deal
  final String parentType;
  final String parentId;
  final String authorId;
  final String authorName;
  final String? fileUrl;
  final String? fileName;
  final int fileSize;
  final bool pinned;
  final DateTime? createdAt;

  bool get isDocument => (fileUrl ?? '').isNotEmpty;

  factory CrmNote.fromFirestore(DocumentSnapshot doc) {
    final d = doc.data() as Map<String, dynamic>? ?? {};
    return CrmNote(
      id: doc.id,
      body: d['body'] as String? ?? '',
      teamId: d['teamId'] as String? ?? '',
      parentType: d['parentType'] as String? ?? 'contact',
      parentId: d['parentId'] as String? ?? '',
      authorId: d['authorId'] as String? ?? '',
      authorName: d['authorName'] as String? ?? '',
      fileUrl: d['fileUrl'] as String?,
      fileName: d['fileName'] as String?,
      fileSize: (d['fileSize'] as num?)?.toInt() ?? 0,
      pinned: d['pinned'] as bool? ?? false,
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'body': body,
        'teamId': teamId,
        'parentType': parentType,
        'parentId': parentId,
        'authorId': authorId,
        'authorName': authorName,
        'fileUrl': fileUrl,
        'fileName': fileName,
        'fileSize': fileSize,
        'pinned': pinned,
        'createdAt': FieldValue.serverTimestamp(),
      };
}

class NotesService {
  NotesService(this._db);
  final FirebaseFirestore _db;

  Future<void> add(CrmNote note) =>
      _db.collection(AppConstants.colNotes).add(note.toFirestore());

  Future<void> delete(String id) =>
      _db.collection(AppConstants.colNotes).doc(id).delete();

  Future<void> togglePin(String id, bool pinned) =>
      _db.collection(AppConstants.colNotes).doc(id).update({'pinned': pinned});
}

final notesServiceProvider = Provider<NotesService>((ref) {
  return NotesService(ref.watch(firestoreProvider));
});

/// Notes and documents for one record, pinned first then newest.
///
/// Single `where` plus client-side sorting, so no composite index.
final notesForProvider =
    StreamProvider.family<List<CrmNote>, String>((ref, parentId) {
  if (parentId.isEmpty) return Stream.value(const <CrmNote>[]);
  return ref
      .watch(firestoreProvider)
      .collection(AppConstants.colNotes)
      .where('parentId', isEqualTo: parentId)
      .snapshots()
      .map((s) {
    final list = s.docs.map(CrmNote.fromFirestore).toList()
      ..sort((a, b) {
        if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
        return (b.createdAt ?? DateTime(0))
            .compareTo(a.createdAt ?? DateTime(0));
      });
    return list;
  });
});

final teamNotesProvider = StreamProvider<List<CrmNote>>((ref) {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return Stream.value(const <CrmNote>[]);
  return ref
      .watch(firestoreProvider)
      .collection(AppConstants.colNotes)
      .where('teamId', isEqualTo: teamId)
      .snapshots()
      .map((s) => s.docs.map(CrmNote.fromFirestore).toList());
});

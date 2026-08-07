/// Where a lead sits in the calling workflow.
///
/// Deliberately separate from [ContactStatus], which tracks the marketing
/// funnel. A telecaller cares about "did I reach them", not "are they an MQL".
enum CallStatus {
  notCalled,
  attempted,
  connected,
  callback,
  interested,
  notInterested,
  wrongNumber,
  doNotCall,
  converted,
}

extension CallStatusX on CallStatus {
  String get label {
    switch (this) {
      case CallStatus.notCalled:
        return 'Not called';
      case CallStatus.attempted:
        return 'Attempted';
      case CallStatus.connected:
        return 'Connected';
      case CallStatus.callback:
        return 'Callback';
      case CallStatus.interested:
        return 'Interested';
      case CallStatus.notInterested:
        return 'Not interested';
      case CallStatus.wrongNumber:
        return 'Wrong number';
      case CallStatus.doNotCall:
        return 'Do not call';
      case CallStatus.converted:
        return 'Converted';
    }
  }

  /// Leads still worth a telecaller's time.
  bool get isOpen =>
      this == CallStatus.notCalled ||
      this == CallStatus.attempted ||
      this == CallStatus.callback ||
      this == CallStatus.interested;

  static CallStatus parse(String? s) => CallStatus.values.firstWhere(
        (v) => v.name == s,
        orElse: () => CallStatus.notCalled,
      );
}

function createPrepDoc(prep) {
  var config = getConfig();
  var title = prep.company_name + ' - ' + prep.role_title + ' Interview Prep - ' + prep.interview_date;
  console.log('Creating Google Doc: ' + title);

  var doc = DocumentApp.create(title);
  var body = doc.getBody();
  body.clear();

  // Quick Reference
  body.appendParagraph('Quick Reference').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendBoldLine_(body, 'Date: ' + prep.interview_date);
  appendBoldLine_(body, 'Time: ' + prep.interview_time);
  appendBoldLine_(body, 'Type: ' + prep.interview_type);
  if (prep.interview_location) appendBoldLine_(body, 'Location: ' + prep.interview_location);
  if (prep.video_link) body.appendParagraph('Video Link: ' + prep.video_link);
  if (prep.interviewer_names && prep.interviewer_names.length > 0) {
    appendBoldLine_(body, 'Interviewer(s): ' + prep.interviewer_names.join(', '));
  }
  body.appendParagraph('');

  // Company Overview
  body.appendParagraph('Company Overview').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(prep.company_overview || 'No information available.');
  body.appendParagraph('');

  // Recent News
  if (prep.recent_news && prep.recent_news.length > 0) {
    body.appendParagraph('Recent News').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    for (var i = 0; i < prep.recent_news.length; i++) {
      body.appendListItem(prep.recent_news[i]).setGlyphType(DocumentApp.GlyphType.BULLET);
    }
    body.appendParagraph('');
  }

  // Role Analysis
  body.appendParagraph('Role Analysis').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(prep.role_analysis || 'No information available.');
  body.appendParagraph('');

  // Interviewer Backgrounds
  if (prep.interviewer_backgrounds) {
    var hasBackgrounds = false;
    for (var name in prep.interviewer_backgrounds) { hasBackgrounds = true; break; }
    if (hasBackgrounds) {
      body.appendParagraph('Interviewer Backgrounds').setHeading(DocumentApp.ParagraphHeading.HEADING1);
      for (var name in prep.interviewer_backgrounds) {
        body.appendParagraph(name).setHeading(DocumentApp.ParagraphHeading.HEADING2);
        body.appendParagraph(prep.interviewer_backgrounds[name]);
        body.appendParagraph('');
      }
    }
  }

  // Potential Interview Questions
  if (prep.potential_questions && prep.potential_questions.length > 0) {
    body.appendParagraph('Potential Interview Questions').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    for (var i = 0; i < prep.potential_questions.length; i++) {
      body.appendListItem((i + 1) + '. ' + prep.potential_questions[i]);
    }
    body.appendParagraph('');
  }

  // Questions to Ask
  if (prep.questions_to_ask && prep.questions_to_ask.length > 0) {
    body.appendParagraph('Questions to Ask').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    for (var i = 0; i < prep.questions_to_ask.length; i++) {
      body.appendListItem((i + 1) + '. ' + prep.questions_to_ask[i]);
    }
    body.appendParagraph('');
  }

  // Key Talking Points
  if (prep.key_talking_points && prep.key_talking_points.length > 0) {
    body.appendParagraph('Key Talking Points').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    for (var i = 0; i < prep.key_talking_points.length; i++) {
      var item = body.appendParagraph('★ ' + prep.key_talking_points[i]);
      item.setBold(true);
      body.appendParagraph('');
    }
  }

  // Sources
  if (prep.sources && prep.sources.length > 0) {
    body.appendParagraph('Sources').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    for (var i = 0; i < prep.sources.length; i++) {
      body.appendListItem(prep.sources[i]).setGlyphType(DocumentApp.GlyphType.BULLET);
    }
  }

  doc.saveAndClose();

  // Move to folder if configured
  if (config.driveFolderId) {
    try {
      var file = DriveApp.getFileById(doc.getId());
      var folder = DriveApp.getFolderById(config.driveFolderId);
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    } catch (e) {
      console.warn('Could not move doc to folder: ' + e);
    }
  }

  var docUrl = doc.getUrl();
  console.log('Doc created: ' + docUrl);
  return docUrl;
}

function appendBoldLine_(body, text) {
  var para = body.appendParagraph(text);
  para.setBold(true);
  return para;
}

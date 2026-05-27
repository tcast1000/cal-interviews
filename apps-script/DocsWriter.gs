function createPrepDoc(prep) {
  var config = getConfig();
  var roundNum = prep.round_number || 1;
  var title = roundNum > 1
    ? prep.company_name + ' — Round ' + roundNum + ' (' + prep.interview_type + ') — ' + prep.interview_date
    : prep.company_name + ' - ' + prep.role_title + ' Interview Prep - ' + prep.interview_date;
  if (prep.is_update) {
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d');
    title += ' (updated ' + stamp + ')';
  }
  console.log('Creating Google Doc: ' + title);

  var doc = DocumentApp.create(title);
  var body = doc.getBody();
  body.clear();

  // Quick Reference
  body.appendParagraph('Quick Reference').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  if (roundNum > 1) appendBoldLine_(body, 'Round: ' + roundNum);
  appendBoldLine_(body, 'Date: ' + prep.interview_date);
  appendBoldLine_(body, 'Time: ' + prep.interview_time);
  appendBoldLine_(body, 'Type: ' + prep.interview_type);
  if (prep.interview_location) appendBoldLine_(body, 'Location: ' + prep.interview_location);
  if (prep.video_link) body.appendParagraph('Video Link: ' + prep.video_link);
  if (prep.interviewer_names && prep.interviewer_names.length > 0) {
    appendBoldLine_(body, 'Interviewer(s): ' + prep.interviewer_names.join(', '));
  }
  body.appendParagraph('');

  // Previous Rounds context (only if round 2+)
  if (roundNum > 1) {
    body.appendParagraph('Round ' + roundNum + ' Context').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    if (prep.previous_rounds_summary && prep.previous_rounds_summary.length > 0) {
      body.appendParagraph('Key takeaways and open threads from prior rounds:');
      for (var i = 0; i < prep.previous_rounds_summary.length; i++) {
        body.appendListItem(prep.previous_rounds_summary[i]).setGlyphType(DocumentApp.GlyphType.BULLET);
      }
    } else {
      body.appendParagraph('No prior debrief notes saved yet. Use the Log Debrief menu item after each round to build this section.');
    }
    body.appendParagraph('');
  }

  // Company Overview
  body.appendParagraph('Company Overview').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(prep.company_overview || 'No information available.');
  body.appendParagraph('');

  // Social Media table (2 columns: platform | URL, one row per platform)
  if (prep.social_links) {
    var rows = [];
    for (var p in prep.social_links) {
      rows.push([p, prep.social_links[p]]);
    }
    if (rows.length > 0) {
      body.appendParagraph('Social Media').setHeading(DocumentApp.ParagraphHeading.HEADING1);
      var table = body.appendTable(rows);
      for (var r = 0; r < rows.length; r++) {
        table.getRow(r).getCell(0).getChild(0).asParagraph().editAsText().setBold(true);
      }
      body.appendParagraph('');
    }
  }

  // Company Values
  if (prep.values && prep.values.length > 0) {
    body.appendParagraph('Company Values').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    for (var v = 0; v < prep.values.length; v++) {
      body.appendListItem(prep.values[v]).setGlyphType(DocumentApp.GlyphType.BULLET);
    }
    body.appendParagraph('');
  }

  // Job Description link
  if (prep.job_description_url) {
    body.appendParagraph('Job Description').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    if (prep.job_description_source) appendBoldLine_(body, 'Source: ' + prep.job_description_source);
    body.appendParagraph(prep.job_description_url);
    body.appendParagraph('');
  }

  // Products & Services
  if (prep.products_and_services && prep.products_and_services.length > 0) {
    body.appendParagraph('Products & Services').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    for (var i = 0; i < prep.products_and_services.length; i++) {
      body.appendListItem(prep.products_and_services[i]).setGlyphType(DocumentApp.GlyphType.BULLET);
    }
    body.appendParagraph('');
  }

  // Competitors
  if (prep.competitors && prep.competitors.length > 0) {
    body.appendParagraph('Competitors').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    for (var i = 0; i < prep.competitors.length; i++) {
      body.appendListItem(prep.competitors[i]).setGlyphType(DocumentApp.GlyphType.BULLET);
    }
    body.appendParagraph('');
  }

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

  // Compensation Context
  var comp = prep.compensation || {};
  if (comp.base_range || comp.total_comp_range) {
    body.appendParagraph('Compensation Context').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    if (comp.base_range) appendBoldLine_(body, 'Base Salary Range: ' + comp.base_range);
    if (comp.total_comp_range) appendBoldLine_(body, 'Total Comp Range: ' + comp.total_comp_range);
    if (comp.equity_notes) body.appendParagraph('Equity: ' + comp.equity_notes);
    if (comp.source) body.appendParagraph('Source: ' + comp.source);
    if (comp.notes) body.appendParagraph('Notes: ' + comp.notes);
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

  // Prior Round Notes appendix
  if (roundNum > 1 && prep.previous_rounds_appendix && prep.previous_rounds_appendix.length > 0) {
    body.appendParagraph('Appendix: Prior Round Notes').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    for (var ai = 0; ai < prep.previous_rounds_appendix.length; ai++) {
      var entry = prep.previous_rounds_appendix[ai];
      var label = (entry.stage_type || 'Round') + ' — ' + (entry.date || '');
      body.appendParagraph(label).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      body.appendParagraph(entry.notes || '(no notes saved)');
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

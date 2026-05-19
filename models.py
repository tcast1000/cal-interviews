from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class Attendee:
    email: str
    name: Optional[str] = None
    is_organizer: bool = False

    @property
    def domain(self) -> Optional[str]:
        if self.email and "@" in self.email:
            domain = self.email.split("@")[1].lower()
            personal_domains = {
                "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
                "icloud.com", "aol.com", "protonmail.com", "mail.com",
                "live.com", "msn.com",
            }
            if domain not in personal_domains:
                return domain
        return None


@dataclass
class InterviewerDetail:
    name: str
    email: Optional[str] = None
    title: Optional[str] = None
    linkedin_url: Optional[str] = None


@dataclass
class InterviewEvent:
    event_id: str
    title: str
    start_time: datetime
    end_time: datetime
    description: Optional[str] = None
    location: Optional[str] = None
    video_link: Optional[str] = None
    calendar_link: Optional[str] = None
    attendees: list[Attendee] = field(default_factory=list)

    company_name: Optional[str] = None
    role_title: Optional[str] = None
    interview_type: Optional[str] = None
    interviewers: list[InterviewerDetail] = field(default_factory=list)
    preparation_instructions: Optional[str] = None
    updated: Optional[str] = None

    @property
    def non_personal_domains(self) -> list[str]:
        return [a.domain for a in self.attendees if a.domain]

    @property
    def organizer(self) -> Optional[Attendee]:
        for a in self.attendees:
            if a.is_organizer:
                return a
        return None


@dataclass
class SearchResult:
    title: str
    snippet: str
    url: str


@dataclass
class ResearchResults:
    company_info: list[SearchResult] = field(default_factory=list)
    products_and_services: list[SearchResult] = field(default_factory=list)
    competitors: list[SearchResult] = field(default_factory=list)
    company_news: list[SearchResult] = field(default_factory=list)
    role_info: list[SearchResult] = field(default_factory=list)
    interviewer_info: dict[str, list[SearchResult]] = field(default_factory=dict)
    glassdoor_info: list[SearchResult] = field(default_factory=list)
    compensation_info: list[SearchResult] = field(default_factory=list)


@dataclass
class PrepDocument:
    company_name: str
    role_title: str
    interview_date: str
    interview_time: str
    interview_location: str
    video_link: str
    interviewer_names: list[str]
    company_overview: str
    products_and_services: list[str]
    competitors: list[str]
    recent_news: list[str]
    role_analysis: str
    interviewer_backgrounds: dict[str, str]
    potential_questions: list[str]
    questions_to_ask: list[str]
    key_talking_points: list[str]
    sheet_talking_points: list[str]
    compensation: dict[str, str]
    sources: list[str]
    interview_type: str = "Interview"

    @classmethod
    def from_dict(cls, data: dict) -> PrepDocument:
        return cls(
            company_name=data.get("company_name", "Unknown Company"),
            role_title=data.get("role_title", "Unknown Role"),
            interview_date=data.get("interview_date", ""),
            interview_time=data.get("interview_time", ""),
            interview_location=data.get("interview_location", ""),
            video_link=data.get("video_link", ""),
            interviewer_names=data.get("interviewer_names", []),
            company_overview=data.get("company_overview", ""),
            products_and_services=data.get("products_and_services", []),
            competitors=data.get("competitors", []),
            recent_news=data.get("recent_news", []),
            role_analysis=data.get("role_analysis", ""),
            interviewer_backgrounds=data.get("interviewer_backgrounds", {}),
            potential_questions=data.get("potential_questions", []),
            questions_to_ask=data.get("questions_to_ask", []),
            key_talking_points=data.get("key_talking_points", []),
            sheet_talking_points=data.get("sheet_talking_points", []),
            compensation=data.get("compensation", {}),
            sources=data.get("sources", []),
            interview_type=data.get("interview_type", "Interview"),
        )

    @classmethod
    def from_json(cls, json_str: str) -> PrepDocument:
        return cls.from_dict(json.loads(json_str))

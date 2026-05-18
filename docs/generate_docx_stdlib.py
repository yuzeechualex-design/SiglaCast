# -*- coding: utf-8 -*-
"""Build SiglaCast capstone DOCX using only Python stdlib (zipfile + XML)."""
import zipfile
import os
import xml.sax.saxutils as xml_escape

OUT_DOWNLOADS = os.path.expanduser(r"~\Downloads\SiglaCast_ITP_Documentation.docx")
OUT_PROJECT = os.path.join(os.path.dirname(__file__), "SiglaCast_ITP_Documentation.docx")


def esc(text):
    return xml_escape.escape(str(text))


def para(text, bold=False, center=False, italic=False):
    jc = "center" if center else "both"
    rpr = ""
    if bold or italic:
        bits = []
        if bold:
            bits.append("<w:b/>")
        if italic:
            bits.append("<w:i/>")
        rpr = "<w:rPr>" + "".join(bits) + "</w:rPr>"
    return (
        f"<w:p><w:pPr><w:spacing w:line='480' w:lineRule='auto'/>"
        f"<w:jc w:val='{jc}'/></w:pPr>"
        f"<w:r>{rpr}<w:t xml:space='preserve'>{esc(text)}</w:t></w:r></w:p>"
    )


def para_lines(lines, center=False, bold=False):
    return "".join(para(line, bold=bold, center=center) for line in lines if line is not None)


def build_document_xml():
    parts = []

    # Title page
    for line in [
        "DAVAO ORIENTAL STATE UNIVERSITY",
        "Guang-guang, Dahican, City of Mati, Davao Oriental",
        "",
        "SIGLACAST: VOTING AND COMMUNITY APPLICATION",
        "FOR DAVAO ORIENTAL STATE UNIVERSITY EVENTS",
        "",
        "Presented to the",
        "Bachelor of Science in Information Technology",
        "Davao Oriental State University",
        "Panabo City, Davao del Norte",
        "",
        "In Partial Fulfillment",
        "of the Requirements for the Course",
        "ITP 121 – INTEGRATIVE PROGRAMMING AND TECHNOLOGIES 1",
        "",
        "Proponent 1",
        "Proponent 2",
        "Proponent 3",
        "Proponent 4",
        "Proponent 5",
        "",
        "MAY 2026",
    ]:
        parts.append(para(line, center=True, bold=("SIGLACAST" in line)))

    parts.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')

    parts.append(para("TABLE OF CONTENTS", center=True, bold=True))
    toc = [
        "TITLE PAGE ................................................................. i",
        "TABLE OF CONTENTS .......................................................... ii",
        "CHAPTER",
        "1 INTRODUCTION",
        "    1.1 Rationale .............................................................. 1",
        "    1.2 Purpose and Description .............................................. 1",
        "    1.3 General Objectives ..................................................... 2",
        "    1.4 Specific Objectives .................................................... 2",
        "    1.5 Scope and Limitations .................................................. 3",
        "    1.6 Significance of the Study .............................................. 3",
        "2 METHODOLOGY",
        "    2.1 Requirement Specification ............................................ 4",
        "        2.1.1 Functional Requirements ........................................ 4",
        "        2.1.2 Non-Functional Requirements .................................... 5",
        "    2.2 System Analysis ........................................................ 5",
        "        2.2.1 Business Process ............................................... 5",
        "        2.2.2 Use Case ......................................................... 6",
        "        2.2.3 System Architecture .............................................. 7",
        "        2.2.4 Integrative Programming Topics Implementation .................... 7",
        "        2.2.5 Data Storage and Message Broker Flow ............................. 8",
        "        2.2.6 Development Procedure ............................................ 9",
        "REFERENCES ................................................................. 10",
        "APPENDIX A – SYSTEM SCREENSHOTS ............................................ 11",
        "APPENDIX B – PHOTO DOCUMENTATION ............................................. 12",
    ]
    parts.extend(para(t) for t in toc)
    parts.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')

    # Chapter 1
    parts.append(para("CHAPTER 1", center=True, bold=True))
    parts.append(para("INTRODUCTION", center=True, bold=True))
    parts.append(para("1.1 Rationale", italic=True, bold=True))
    parts.append(para(
        "University events at Davao Oriental State University, such as student council elections, "
        "campus polls, intramural awards, and organizational activities, require timely participation, "
        "transparent vote counting, and clear communication among students, faculty, and administrators. "
        "Traditional methods that rely on paper ballots, manual tally sheets, and scattered social media "
        "updates often result in delayed results, limited audit trails, and weak engagement outside the physical venue."
    ))
    parts.append(para(
        "SiglaCast addresses these concerns by providing a unified web-based voting and community platform. "
        "The system allows authenticated students to participate in campus events, cast votes under configurable rules, "
        "view live tallies, read announcements, interact in a community feed, exchange private messages, and manage personal profiles. "
        "Administrators can create events, publish announcements, and monitor participation through role-based dashboards. "
        "The project also integrates core topics from Integrative Programming and Technologies 1, including object-oriented programming, "
        "messaging brokers, XML processing, XSLT transformation, and administrative scripting."
    ))

    sections_ch1 = [
        ("1.2 Purpose and Description", [
            "The purpose of SiglaCast is to design and implement an advanced information system that supports secure event voting and digital community engagement for Davao Oriental State University. The system is implemented as a full-stack web application composed of a React frontend, a Node.js and Express backend REST API, JSON-based persistent storage, optional RabbitMQ or Kafka message brokers, and admin automation scripts.",
            "SiglaCast uses a blue, yellow, and white visual theme. Students register or sign in, browse open events, submit votes within per-event limits, and observe live tally displays. The community module supports posts with images, reactions, and comments. The messaging module allows user search, friend connections, and private chat threads. Administrators manage events, announcements, and dashboards. XML export, XML parsing, and XSLT-based HTML reporting demonstrate structured data handling required by the curriculum.",
        ]),
        ("1.3 General Objectives", [
            "The general objective of this study is to develop SiglaCast, an integrative web-based voting and community application for Davao Oriental State University events that improves participation, transparency, and communication while demonstrating required programming technologies in a single cohesive system.",
        ]),
        ("1.4 Specific Objectives", [
            "1. To implement secure user authentication and role-based access for students and administrators using JSON Web Tokens and password hashing.",
            "2. To design and develop event management with configurable voting strategies, vote limits, candidate profiles, and live tally visualization.",
            "3. To provide community features including posts, image uploads, reactions, comments, announcements, and in-app notifications.",
            "4. To implement private messaging with user search, friend management, conversation listing, and periodic refresh through polling.",
            "5. To apply object-oriented programming principles including inheritance, encapsulation, and polymorphism in backend domain modeling.",
            "6. To integrate a messaging broker (RabbitMQ or Apache Kafka) for asynchronous event publishing on votes, posts, announcements, and messages.",
            "7. To implement XML generation, XML parsing, and XSLT transformation for event data reporting.",
            "8. To create administrative scripts for environment setup, queue monitoring, and system maintenance.",
        ]),
        ("1.5 Scope and Limitations", [
            "Scope. SiglaCast covers user registration and login, student and admin dashboards, event creation and voting, live tallies, community posts, announcements, notifications, profile and avatar management, private messaging, XML and XSLT endpoints, and message broker integration.",
            "Limitations. The system uses a JSON file (db.json) as its primary data store rather than a relational database server. Private chat delivery uses HTTP polling instead of WebSockets. Message broker consumers currently log events for demonstration. Production hardening such as clustered hosting and institutional single sign-on are outside the current scope.",
        ]),
        ("1.6 Significance of the Study", [
            "SiglaCast benefits students by offering a convenient and transparent channel to vote and stay informed about campus events. Administrators gain centralized tools to publish events and communicate announcements. The project demonstrates how integrative programming topics can be applied in a real-world campus system at Davao Oriental State University.",
        ]),
    ]
    for title, paragraphs in sections_ch1:
        parts.append(para(title, italic=True, bold=True))
        for p in paragraphs:
            parts.append(para(p))

    parts.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    parts.append(para("CHAPTER 2", center=True, bold=True))
    parts.append(para("METHODOLOGY", center=True, bold=True))

    sections_ch2 = [
        ("2.1 Requirement Specification", []),
        ("2.1.1 Functional Requirements", [
            "The system shall allow users to register, log in, log out, and refresh sessions using access and refresh tokens.",
            "The system shall distinguish student and admin roles and restrict admin-only routes.",
            "The system shall allow administrators to create events with title, description, rules, cover image, candidates, voting strategy, status, and maximum votes per user.",
            "The system shall allow students to cast votes on open events and enforce per-event vote limits.",
            "The system shall compute and display live vote tallies with visual progress indicators.",
            "The system shall provide a community module for posts with images, reactions, and comments.",
            "The system shall support announcements, notifications, profile updates, private messaging, XML export, XML parsing, XSLT transformation, and message broker publishing.",
        ]),
        ("2.1.2 Non-Functional Requirements", [
            "Usability: Consistent blue, yellow, and white theme with clear navigation.",
            "Security: bcrypt password hashing and JWT-protected API routes.",
            "Performance: Polling for conversation and tally updates during active use.",
            "Maintainability: Modular classes for users, vote strategies, and broker implementations.",
            "Portability: Node.js runtime with optional Docker for RabbitMQ and Kafka.",
            "Reliability: Persistence to db.json with in-memory broker fallback.",
        ]),
        ("2.2.1 Business Process", [
            "The SiglaCast business process begins when an administrator creates and opens a campus event. Students authenticate, review candidates, and submit votes. The system records votes, updates tallies, notifies voters, and publishes vote.cast broker events. Students may use the community feed, announcements, notifications, and private messages. Administrators monitor dashboards and export XML reports. The process ends when an event is closed and final tallies are available.",
        ]),
        ("2.2.2 Use Case", [
            "UC-01 Register Account; UC-02 Login; UC-03 Vote in Event; UC-04 View Live Tally; UC-05 Create Event (Admin); UC-06 Create Community Post; UC-07 React and Comment; UC-08 Send Private Message; UC-09 Add Friend; UC-10 Export XML Report; UC-11 Publish Announcement (Admin).",
        ]),
        ("2.2.3 System Architecture", [
            "SiglaCast uses a three-tier architecture: React frontend (Vite), Express REST API on port 4000, and JSON file storage (db.json) plus uploads folder. RabbitMQ or Kafka provides asynchronous queues: vote.cast, post.created, announcement.created, and message.sent.",
        ]),
        ("2.2.4 Integrative Programming Topics Implementation", [
            "OOP: User, Student, Admin classes; VoteStrategy polymorphism. Messaging: RabbitBroker, KafkaBroker, InMemoryBroker. XML: GET /api/xml/events.xml and POST /api/xml/parse. XSLT: GET /api/xml/events.html. Scripting: JavaScript, PowerShell setup-env.ps1, Bash setup-env.sh, monitor-queue.js with CLI arguments.",
        ]),
        ("2.2.5 Data Storage and Message Broker Flow", [
            "Data is stored in db.json (users, events, votes, posts, announcements, notifications, friends, messages). On vote, post, announcement, or message actions, the API saves to db.json then publishes JSON events to the configured broker. Consumers log events for audit demonstration.",
        ]),
        ("2.2.6 Development Procedure", [
            "Development followed an iterative approach: backend API first, then React frontend modules, then integrative topic integration and Docker broker testing, ending with manual validation using demo accounts and documentation.",
        ]),
    ]
    for title, paragraphs in sections_ch2:
        parts.append(para(title, italic=True, bold=True))
        for p in paragraphs:
            parts.append(para(p))

    parts.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    parts.append(para("REFERENCES", center=True, bold=True))
    refs = [
        "Apache Kafka. (2024). Apache Kafka documentation. https://kafka.apache.org/documentation/",
        "Express.js. (2024). Express web framework for Node.js. https://expressjs.com/",
        "JSON Web Token (JWT). (2024). RFC 7519. IETF.",
        "Node.js. (2024). https://nodejs.org/",
        "RabbitMQ. (2024). https://www.rabbitmq.com/documentation.html",
        "React. (2024). https://react.dev/",
        "W3C. (1999). XSL Transformations (XSLT) version 1.0.",
        "W3C. (2008). Extensible Markup Language (XML) 1.0.",
    ]
    for r in refs:
        parts.append(para(r))

    parts.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    parts.append(para("APPENDIX A", center=True, bold=True))
    parts.append(para("SYSTEM SCREENSHOTS", center=True, bold=True))
    parts.append(para(
        "Insert screenshots: login, dashboards, events with tally, community, messages, announcements, notifications, profile, and XML/HTML export. Label figures as Figure A-1, A-2, and so on."
    ))
    parts.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    parts.append(para("APPENDIX B", center=True, bold=True))
    parts.append(para("PHOTO DOCUMENTATION", center=True, bold=True))
    parts.append(para(
        "Insert photo documentation of team meetings, testing, and defense preparation with captions and dates."
    ))

    body = "".join(parts)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>{body}<w:sectPr>
<w:pgSz w:w="12240" w:h="15840"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="2160"/>
</w:sectPr></w:body></w:document>"""


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""

STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>
<w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
</w:styles>"""

CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>SiglaCast ITP Documentation</dc:title>
<dc:creator>SiglaCast Team</dc:creator>
</cp:coreProperties>"""


def write_docx(path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", RELS)
        z.writestr("word/document.xml", build_document_xml())
        z.writestr("word/_rels/document.xml.rels", DOC_RELS)
        z.writestr("word/styles.xml", STYLES)
        z.writestr("docProps/core.xml", CORE)


if __name__ == "__main__":
    write_docx(OUT_DOWNLOADS)
    write_docx(OUT_PROJECT)
    print("Created:")
    print(" ", OUT_DOWNLOADS)
    print(" ", OUT_PROJECT)

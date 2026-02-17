# Overview

InBack/Clickback is a Flask-based real estate platform focused on cashback services for new construction properties in the Krasnodar region, with plans for expansion. It aims to connect buyers and developers, streamline property transactions, and integrate CRM functionalities. Key features include cashback incentives, intuitive property search with interactive maps, complex comparisons, and a manager dashboard for tracking.

# User Preferences

Preferred communication style: Simple, everyday language.

**Design Preferences:**
- Brand color: rgb(0 136 204) = #0088CC - consistently applied across entire dashboard
- No purple/violet/fuchsia colors in UI

# System Architecture

## Frontend

The frontend utilizes server-side rendered HTML with Jinja2 and CDN-based TailwindCSS for a mobile-first, responsive design. Interactivity is provided by modular vanilla JavaScript, enabling features like smart search, real-time filtering, Yandex Maps integration, property comparison, and PDF generation. UI/UX emphasizes AJAX-powered sorting/filtering, interactive map pages, mobile-optimized search, and a consistent application of the brand color #0088CC, avoiding purple/violet/fuchsia tones.

**Key UI Features:**
- **Fullscreen Map:** Dynamic clustering, city-filtered property display, 2-column desktop layout (cards + map), real-time marker updates, quick room filters, multi-city support, marker highlighting on card hover, and area drawing functionality for filtering properties within a custom polygon.
- **Responsive Layouts:** Property cards utilize a responsive grid (1, 2, or 3 columns based on viewport).
- **Unified Width Alignment:** `max-w-7xl mx-auto` for consistent, centered content across all sections.
- **Active Filters Display:** Visual indicator for applied filters with clickable chips for clearing.
- **Filter Synchronization:** Complete bi-directional filter sync between map view and list view using URL parameters. All map filters (rooms, price, area, floor, developers, districts, completion status, object classes, building status, features, renovation, floor options, etc.) are saved to URL and auto-applied when page loads.
- **Hybrid Filter System:** Early wrapper functions detect context (modal map vs list view) and route appropriately - AJAX for modal map (no page reload), URL parameters for list view (server-side filtering).

## Backend

The backend is built with Flask, following an MVC pattern with blueprints and SQLAlchemy/PostgreSQL. It uses Flask-Login for session management and RBAC (Regular Users, Managers, Admins). Features include phone verification via SMS, multi-city data management, and an intelligent automatic detection system for sold properties.

**Core Systems:**
- **Intelligent Address Parsing & Multi-City Smart Search:** Leverages DaData.ru and Yandex Maps Geocoder for address normalization, geocoding, and city-aware search suggestions covering cities, residential complexes, districts, and streets.
- **Balance Management System:** Production-ready system with `UserBalance`, `BalanceTransaction`, and `WithdrawalRequest` models, supporting cashback and withdrawals with Decimal precision.
- **Comprehensive SEO Optimization:** Multi-city SEO features including Canonical URLs, City-Aware Meta Tags, JSON-LD, sitemaps, robots.txt, and HSTS.
- **Parser Integration System:** Universal `ParserImportService` for automated data import from external sources, handling property hierarchies and generating SEO-friendly slugs.
- **District & Neighborhood System:** Hierarchical catalog of districts and neighborhoods with API support for city-specific filtering.
- **Deal Card CRM System:** Bitrix24-style deal management with configurable pipeline stages (admin-managed via `DealStageConfig` model), activity feed with timestamped comments and history, tasks with priorities/due dates, inline field editing (price, cashback, property details), automatic audit logging, and task reminder notifications. Completed/rejected deals are locked (read-only) with closing info banners (rejection reason + comment). Deal closing modal offers "Успешна"/"Проиграна" choice; rejected deals require reason selection from predefined list + optional comment. Stage transitions prompt inline task creation (title, date, priority). Models: `Deal` (with `rejection_reason`, `closing_comment`, `closed_at`), `DealComment`, `DealTask`, `DealHistory`, `DealStageConfig`. Templates: `templates/manager/deal_card.html`, `templates/admin/deal_stages.html`.
- **Deals Kanban Board:** Visual pipeline view showing deals grouped by stage columns with counts, client info, pricing, and task badges. Template: `templates/manager/deals_kanban.html`. Route: `/manager/kanban`.
- **Deals Archive:** Closed deals (completed + rejected) with statistics (conversion rate, revenue, cashback, avg deal), rejection reasons breakdown, manager comparison table. Accessible to managers (own deals), РОП/is_rop (all deals with manager filter), and admins. Templates: `templates/manager/deals_archive.html`, `templates/admin/deals_archive.html`. Routes: `/manager/deals-archive`, `/admin/deals-archive`.
- **Task Calendar:** FullCalendar-based monthly/weekly view of deal tasks color-coded by status (active/overdue/completed/high-priority). Template: `templates/manager/tasks_calendar.html`. Route: `/manager/calendar`.
- **РОП Role (Head of Sales):** Manager model has `is_rop` boolean field. РОП users can view all managers' deals in the archive, filter by manager, and see comparative statistics.
- **Organizational Structure:** Hierarchical department system with roles and permissions. Admin-managed via `/admin/org-tree`. Models: `Department` (with parent hierarchy, head manager), `OrgRole` (with granular permissions for deals, archives, responsible changes, statistics). Default roles: Директор (all access), РОП (department access), Менеджер (own access only). Managers are assigned to departments and roles by admin. Permissions control: deal visibility (all/department/own), archive access, deal responsible reassignment, statistics viewing. Route: `/admin/org-tree`. API: `/admin/api/departments`, `/admin/api/roles`, `/admin/api/managers/assign`, `/api/deals/{id}/reassign`.

## Data Storage

PostgreSQL, managed via SQLAlchemy, stores Users, Managers, Properties, Residential Complexes, Developers, Marketing Materials, transactional records, and search analytics.

## Authentication & Authorization

A Flask-Login based system supports Regular Users, Managers, and Admins. Regular user login is exclusively via phone number + SMS verification. The system includes streamlined registration, temporary password generation via SMS, and mandatory profile completion. All authentication is secured with CSRF tokens, rate limiting, and code expiration.

# External Dependencies

## Third-Party APIs

-   **SendGrid**: Email services.
-   **OpenAI**: Smart search and content generation.
-   **Telegram Bot API**: Notifications and communication.
-   **Yandex Maps API**: Interactive maps, geocoding.
-   **DaData.ru**: Address normalization and suggestions.
-   **RED SMS**: Russian SMS service for phone verification.
-   **Google Analytics**: User behavior tracking.
-   **LaunchDarkly**: Feature flagging.
-   **Chaport**: Chat widget.
-   **reCAPTCHA**: Spam and bot prevention.
-   **ipwho.is**: IP-based city detection.

## Web Scraping Infrastructure

-   `selenium`, `playwright`, `beautifulsoup4`, `undetected-chromedriver`: Automated data collection.

## PDF Generation

-   `weasyprint`, `reportlab`: Generating property documents and reports.

## Image Processing

-   `Pillow`: Image resizing, compression, WebP conversion, QR code generation.
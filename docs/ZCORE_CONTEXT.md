# ZCORE PRODUCTION — MASTER PROJECT CONTEXT

## 1. PROJECT OVERVIEW

Zcore Production is a cloud-based, modular ERP (Enterprise Resource Planning) platform developed by Zcore. It is designed specifically for small and medium-sized manufacturing companies, especially businesses involved in CNC machining, metalworking, steel and aluminum processing, toolmaking, mechanical engineering, and industrial production.

The main objective is to digitize and centralize manufacturing operations, replacing Excel spreadsheets, paper documentation, manual calculations, and disconnected applications with one integrated system.

Zcore Production must be developed as a real commercial software product, not just a prototype or a collection of CRUD pages. It should be reliable, scalable, secure, configurable, and suitable for daily use in an actual production environment.

The initial target customers are manufacturing companies with approximately 5–250 employees. The platform should support different company sizes, production processes, organizational structures, and levels of operational complexity.

The product should be modular, allowing each customer to activate and pay for the modules they need.

## 2. PRODUCT VISION

Build a modern manufacturing ERP that connects the entire workflow:

Customer order → Production order → Production planning → Material preparation → Machine operations → Production reporting → Quality control → Finished goods inventory → Delivery.

Management should be able to see what is happening throughout the company without manually collecting information from multiple employees, machines, spreadsheets, or departments.

Workers should be able to record production activities quickly and accurately, preferably directly from a mobile phone or tablet near their workstation.

Warehouse staff should have accurate information about material availability, reserved quantities, tool inventory, stock movements, and finished products.

The system should calculate production progress, actual working time, downtime, scrap, material consumption, productivity, and expected completion dates wherever sufficient data is available.

## 3. CORE DESIGN PRINCIPLES

- Modular architecture: each business function should be implemented as a well-defined module.
- Multi-tenant SaaS: multiple companies can use the same platform while their data remains strictly isolated.
- Role-based access control: users should see and modify only the information permitted by their role.
- One source of truth: related modules must share consistent data rather than duplicate independent records.
- Auditability: important actions, inventory movements, production reports, and changes must be traceable.
- Archive instead of delete: business records should generally be archived or deactivated rather than permanently deleted.
- Mobile-first worker experience: shop-floor interfaces must be usable on phones and tablets.
- Desktop-first management experience: complex planning, reporting, configuration, and administration should work exceptionally well on desktop.
- Configurability: shifts, units, machine types, production processes, permissions, and business rules should not be unnecessarily hardcoded.
- Bosnian language first, with architecture that supports future internationalization.
- Reliable calculations: inventory, production quantities, costs, work hours, and forecasts must use explicit and testable business rules.

## 4. MAIN ERP MODULES

### 4.1. Dashboard

Provide different dashboards depending on the user's role.

Management dashboard:
- Active production orders.
- Delayed and upcoming orders.
- Overall production progress.
- Machine utilization and downtime.
- Worker attendance and working hours.
- Material shortages and low-stock warnings.
- Tool availability.
- Scrap quantities.
- Finished goods inventory.
- Production performance and historical trends.
- Important notifications, tasks, and unresolved issues.

Production manager dashboard:
- Current production queue.
- Orders awaiting preparation.
- Machine assignments.
- Work in progress.
- Bottlenecks and downtime.
- Expected completion dates.
- Material and tool availability.

Warehouse dashboard:
- Current stock levels.
- Reservations and material requirements.
- Incoming and outgoing movements.
- Low-stock warnings.
- Tool condition and replacement requirements.

Worker dashboard:
- Assigned machines and tasks.
- Current production orders.
- Shift information.
- Quick production reporting.
- Downtime reporting.
- Tool and insert change reporting.
- Personal working-time records where permitted.

### 4.2. Production Orders

Create and manage production orders throughout their lifecycle.

Each production order should support:
- Unique order number.
- Customer and related sales order, if applicable.
- Product or part identification.
- Part number and revision.
- Description and technical specifications.
- Ordered quantity.
- Planned start and completion dates.
- Actual start and completion dates.
- Priority.
- Current status.
- Assigned machines and operations.
- Assigned workers or teams.
- Required materials.
- Required tools and consumables.
- Estimated setup time and production time.
- Actual production time.
- Planned and actual material consumption.
- Good quantity and scrap quantity.
- Production instructions.
- CAD drawings, PDF files, technical documents, and attachments.
- Notes and complete status history.

Suggested statuses:
Draft, Planned, Awaiting Materials, Ready for Production, In Progress, Paused, Quality Check, Completed, Delivered, Cancelled, Archived.

Status transitions must be validated according to business rules. For example, an order should not become completed merely because someone changes a dropdown if required quantities or reporting steps remain incomplete.

Support partial production, multiple operations, multiple machines, and multiple workers where the workflow requires them.

### 4.3. Production Planning and Scheduling

Allow authorized users to plan production and allocate work across machines and shifts.

The system should consider:
- Due dates.
- Priority.
- Machine availability.
- Machine capabilities.
- Available workers.
- Shift schedules.
- Setup time.
- Estimated cycle time per piece.
- Material availability.
- Tool availability.
- Existing machine assignments.
- Reported downtime.
- Remaining production quantities.

Calculate estimated completion dates from actual progress and remaining work whenever possible.

When production falls behind schedule or a machine becomes unavailable, highlight affected orders and provide updated estimates.

Avoid double-booking machines or creating conflicting assignments without explicitly warning the user.

### 4.4. Production Operations and CNC Machines

Maintain a register of machines and equipment.

Machine information should include:
- Machine name and unique identifier.
- Machine type.
- Manufacturer and model.
- Serial number, if relevant.
- Work area or location.
- Capabilities and compatible operations.
- Status: available, running, stopped, maintenance, or inactive.
- Assigned operators.
- Current production order.
- Maintenance history.
- Downtime history.
- Notes and attachments.

Support CNC machines and other manufacturing equipment.

For each operation, track the machine, production order, operator or team, planned quantity, completed quantity, cycle time, setup time, downtime, scrap, and relevant notes.

Do not assume every machine has automatic data integration. Manual reporting must work independently, while future integrations can be added through well-defined interfaces.

### 4.5. Production Reporting

Workers must be able to submit production reports with minimal friction.

A report may include:
- Production order and operation.
- Machine.
- Operator or team.
- Shift.
- Start and end times, where relevant.
- Good quantity produced.
- Scrap quantity.
- Downtime duration.
- One or more downtime reasons.
- Tool or cutting-insert changes.
- Notes and relevant attachments.

Support teams working across multiple machines. Where several workers contribute to the same operation, the system must distinguish machine output from individual working time and prevent accidental double-counting.

Production reporting must update order progress, inventory calculations, productivity metrics, and estimated completion dates consistently.

### 4.6. Material Warehouse

Manage raw materials and production stock, including bars, rods, sheets, plates, profiles, and other manufacturing materials.

Material records should include:
- Unique material code.
- Name and description.
- Material grade or specification.
- Dimensions and form.
- Unit of measurement.
- Supplier.
- Current stock.
- Reserved stock.
- Available stock.
- Minimum stock level.
- Storage location.
- Purchase price and cost history where applicable.
- Batch or lot information where required.
- Stock movement history.

Support:
- Goods receipt.
- Material issuance.
- Transfers between locations.
- Reservations for production orders.
- Returns from production.
- Stock corrections with recorded reasons.
- Stocktaking.
- Minimum-stock alerts.
- Material shortage warnings.

For bar stock and similar materials, support configurable yield calculations and approximate automatic material consumption based on cut length, part dimensions, kerf, and usable remnants when the necessary data is available.

Material consumption must follow explicit business rules and must be traceable to the relevant production order.

### 4.7. Tools Warehouse

Manage cutting tools, tool holders, inserts, drills, milling cutters, and other production equipment and consumables.

Distinguish between reusable tools and consumable or replaceable components.

Track:
- Tool identification.
- Tool type and specifications.
- Quantity and storage location.
- Current availability.
- Assigned machine or production order.
- Issue and return transactions.
- Replacement history.
- Wear or condition, where applicable.
- Minimum stock levels.
- Supplier and purchase information.
- Tool-related costs, where relevant.

Operators should be able to report tool changes from the shop floor.

The system should record tool consumption and replacements without treating every reusable tool as a permanently consumed item.

### 4.8. Finished Goods Warehouse

Track completed products and parts independently from raw materials and tools.

Support:
- Finished product identification.
- Production order linkage.
- Good quantity received into stock.
- Reserved quantities.
- Available quantities.
- Storage locations.
- Batch or lot tracking where applicable.
- Dispatch and delivery records.
- Returns and stock adjustments.
- Inventory history.

Scrap must never be added to good finished-goods inventory.

### 4.9. Workers and Employees

Maintain employee records with appropriate access restrictions.

Employee profiles may include:
- Employee number.
- Name and surname.
- Username and authentication identity.
- Department and job title.
- Skills and qualifications.
- Assigned machines.
- Employment status.
- Role and permissions.
- Shift configuration.
- Start date.
- Contact and administrative information where necessary.
- Relevant documents and notes.

Support employee activation and deactivation, role assignment, skill tracking, and historical records.

Sensitive employee information must not be visible to unauthorized users.

### 4.10. Attendance, Working Hours, and Shifts

Track attendance, work sessions, shift assignments, overtime, and working hours.

The shift system must be configurable. It should support 8-hour, 12-hour, and other configured shifts rather than assuming every company uses the same schedule.

Support:
- Clock-in and clock-out.
- Manual corrections with authorization and an audit trail.
- Shift calendars.
- Configurable breaks.
- Night shifts crossing midnight.
- Overtime calculations.
- Absences and leave records.
- Monthly working-hour summaries.
- Exportable records for payroll processing.

A configured 12-hour shift may include a 30-minute break. Break treatment and working-time calculations must follow the company's configuration and applicable rules.

Prevent duplicate clock-ins, invalid clock-outs, and overlapping work sessions.

Store timestamps consistently and display them in the configured company timezone, initially Europe/Sarajevo.

### 4.11. Productivity and Downtime

Calculate production performance using configurable and clearly documented formulas.

Track:
- Planned versus actual production.
- Good pieces per hour.
- Cycle time per piece.
- Setup time.
- Total downtime.
- Multiple downtime events and reasons.
- Scrap quantity.
- Machine utilization.
- Estimated remaining production time.

Allow downtime reasons such as:
- Machine failure.
- Tool change.
- Material shortage.
- Setup or adjustment.
- Waiting for instructions.
- Quality issue.
- Operator unavailable.
- Other configurable reasons.

Provide smart suggestions for downtime reasons, but let users confirm the correct reason.

Where cycle-time data is available, recalculate expected completion dates when actual productivity differs from the plan.

### 4.12. Purchasing and Suppliers

Provide supplier records, purchase requests, purchase orders, expected deliveries, incoming goods, and purchase history.

Connect purchasing to material and tool inventory.

Allow the system to identify shortages based on production demand, reservations, available stock, and configured minimum levels.

### 4.13. Customers, Sales, and Orders

Maintain customer information and commercial records.

Support customer orders, quotations, product specifications, delivery dates, and links between customer demand and production orders.

Keep the architecture ready for more advanced CRM, sales, invoicing, and financial integrations.

### 4.14. Quality Control

Support configurable quality checks during and after production.

Track inspection results, accepted quantities, rejected quantities, nonconformities, corrective actions, and relevant documentation.

Quality checks should be linked to production orders, operations, products, and batches where applicable.

### 4.15. Maintenance

Maintain preventive and corrective maintenance records for machines and equipment.

Track maintenance tasks, schedules, downtime, service history, spare parts, and machine availability.

Maintenance status should affect production planning when a machine is unavailable.

### 4.16. Tasks and Notifications

Provide internal tasks and notifications for relevant operational events.

Examples:
- Production order approaching its deadline.
- Production order overdue.
- Material stock below the minimum level.
- Insufficient material for a planned order.
- Machine downtime reported.
- Tool or insert replacement required.
- Production report awaiting review.
- Quality issue recorded.
- Maintenance due.

Support task assignment, deadlines, status, priorities, and completion history.

Avoid excessive notifications. Alerts should be relevant, actionable, and configurable.

### 4.17. Reports and Analytics

Provide reports for:
- Production output.
- Order completion and delays.
- Machine utilization.
- Downtime by reason.
- Worker hours.
- Shift performance.
- Scrap quantities and rates.
- Material consumption.
- Inventory valuation.
- Tool consumption.
- Production costs.
- On-time delivery.
- Historical performance.

Reports should support filtering by date range, customer, order, machine, worker, material, and other relevant dimensions.

Use clear tables, charts, summaries, and export options.

## 5. IMPORTANT BUSINESS RULES

These rules are critical and must be preserved throughout development.

1. Good production and scrap are separate quantities.
2. Only good pieces enter finished-goods inventory.
3. Material consumption must account for all material used in production, including material associated with scrapped pieces.
4. Scrap quantity must be recorded explicitly and must not be added to good stock.
5. Machine output and individual employee working hours are different measurements.
6. Multiple workers may contribute to one machine or production operation.
7. A team working across multiple machines must not cause production quantities or working hours to be counted twice.
8. Shifts and breaks must be configurable.
9. Downtime must support a total duration and multiple categorized events.
10. Production forecasts should recalculate when actual cycle times, downtime, or remaining quantities change.
11. Low-stock and deadline warnings must respect configured thresholds.
12. Important operational actions must be auditable.
13. Business records should generally be archived rather than permanently deleted.
14. Inventory changes should be recorded as transactions with references and reasons instead of silently overwriting stock balances.
15. Production reports and inventory transactions must be idempotent where duplicate submissions could otherwise create duplicate quantities or movements.
16. Validate all important calculations on the server, not only in the user interface.

## 6. USERS, ROLES, AND PERMISSIONS

The initial permission model must include:

### Administrator
Full system configuration and authorized access to all company modules.

### Director / Management
Full operational access across the company, including production, inventory, workers, reports, and business settings according to assigned permissions.

### Head of Production
Full access to production planning, production orders, machines, assignments, reports, and operational oversight. The initial configuration should allow the director, administrator, and head of production to have equivalent operational access, with system administration permissions configurable separately.

### Warehouse Worker
Manage assigned warehouse operations, including material and tool stock, receipts, issues, transfers, reservations, and stocktaking.

### CNC Operator / Production Worker
View assigned machines, orders, and operations. Submit production quantities, scrap, downtime, tool changes, and permitted notes. Access only the employee information and operational data required for the job.

The architecture must support future custom roles and granular permissions.

Use secure authentication with username-based sign-in where appropriate. Passwords must never be stored in plain text or managed as ordinary spreadsheet values.

## 7. USER EXPERIENCE AND VISUAL DESIGN

The interface should feel like a premium modern enterprise SaaS product.

Design references include Linear and Stripe for clarity, consistency, information hierarchy, and visual polish. Do not copy their interfaces directly.

Visual principles:
- Clean and minimal.
- Professional manufacturing-oriented design.
- Consistent spacing and typography.
- Clear status indicators.
- High information density without visual clutter.
- Responsive layouts.
- Accessible contrast and readable labels.
- Fast navigation.
- Useful empty, loading, success, and error states.
- Consistent tables, forms, filters, dialogs, and notifications.

Desktop screens should be optimized for management and planning. Worker workflows should be optimized for touchscreens, large controls, and minimal data entry.

The initial interface language is Bosnian. Keep translation keys and language-specific strings structured so additional languages can be added later.

Use consistent terminology throughout the application.

## 8. TECHNICAL ARCHITECTURE

Preferred modern web stack:

- TypeScript.
- React and Next.js or another explicitly agreed React application architecture.
- Tailwind CSS.
- shadcn/ui for reusable interface components where appropriate.
- Supabase PostgreSQL for relational data.
- Supabase Auth or another well-defined authentication solution.
- Supabase Row Level Security (RLS) for database-level tenant and user isolation.
- Server-side services and validated API endpoints for business operations.
- Schema validation for inputs.
- Database migrations tracked in version control.
- Automated tests for critical business rules.

The exact application framework and deployment architecture should be confirmed before major implementation. Avoid introducing unnecessary technologies or mixing incompatible architectural approaches.

Use PostgreSQL relationships, foreign keys, constraints, indexes, and transactions appropriately.

Separate business logic from UI components. Keep the application modular, maintainable, and testable.

## 9. MULTI-TENANCY AND SECURITY

Zcore Production is intended to serve multiple independent companies.

The architecture must support:
- Organizations or tenants.
- Users who belong to authorized organizations.
- Organization-specific configuration.
- Tenant-scoped business records.
- Tenant-scoped roles and permissions.
- Strict database access policies.
- Secure document storage.
- Audit logs.
- Secure authentication and session management.

Every tenant-owned record must be associated with the appropriate organization.

Do not rely only on frontend filtering to isolate customer data. Enforce tenant isolation at the database and server levels.

Never expose Supabase service-role keys, secrets, or privileged credentials to the browser.

Use least-privilege access and validate permissions for every sensitive operation.

## 10. CORE DATA MODEL

Design the data model around related entities, including:

- Organizations.
- Users and memberships.
- Roles and permissions.
- Customers.
- Suppliers.
- Products and parts.
- Production orders.
- Production operations.
- Machines.
- Machine assignments.
- Production reports.
- Production downtime events.
- Scrap records.
- Materials.
- Material stock balances and movements.
- Material reservations.
- Tools and consumables.
- Tool transactions.
- Finished goods.
- Finished goods movements.
- Employees.
- Shifts and shift assignments.
- Attendance sessions.
- Breaks and overtime.
- Purchase orders and receipts.
- Quality inspections.
- Maintenance records.
- Tasks and notifications.
- Documents and attachments.
- Audit logs.
- Configurable company settings.

This is a conceptual list, not a requirement to create every table immediately. Design relationships and normalization carefully, and implement only what is justified by the current development phase.

## 11. COMMERCIAL PRODUCT STRATEGY

Zcore Production should be sold as a modular SaaS product.

Potential modules include:
- Zcore Core.
- Production Orders.
- Production Planning.
- Machines and Production Reporting.
- Employees and Working Hours.
- Material Warehouse.
- Tools Warehouse.
- Finished Goods Warehouse.
- Purchasing and Suppliers.
- Quality Control.
- Maintenance.
- Reports and Analytics.

Customers should be able to activate modules according to their needs, with permissions and dependencies handled centrally.

The shared Zcore platform should eventually support other industry-specific products without duplicating the foundational architecture.

However, prioritize a useful, stable manufacturing product before expanding into unrelated industries.

## 12. DEVELOPMENT APPROACH

Work incrementally and preserve a clear separation between planning, implementation, and verification.

For every feature:

1. Understand the business problem.
2. Define the user roles and workflow.
3. Specify business rules and edge cases.
4. Design the database changes.
5. Implement secure server-side logic.
6. Build the user interface.
7. Add validation and error handling.
8. Test important scenarios.
9. Verify permissions and tenant isolation.
10. Document the implementation and remaining limitations.

Do not generate a huge application in one unverified step.

Prefer small, coherent changes that can be tested and reviewed. Avoid replacing working code unnecessarily.

Do not invent existing files, database tables, API endpoints, environment variables, or implementation details. Inspect the actual repository before making assumptions.

Before changing existing architecture, explain the implications and preserve working functionality.

When modifying a project, identify the files to change, implement the feature, run relevant tests and checks, and summarize the results honestly. Never claim a test passed unless it was actually executed successfully.

## 13. EXPECTED ROLE OF CLAUDE

Act as a senior software architect, full-stack engineer, manufacturing ERP domain specialist, database designer, and pragmatic product development partner.

Help me:
- Design the architecture.
- Define modules and workflows.
- Translate manufacturing requirements into reliable software.
- Design PostgreSQL schemas and migrations.
- Implement APIs and services.
- Build polished, responsive user interfaces.
- Enforce permissions and tenant isolation.
- Test production and inventory calculations.
- Identify edge cases and operational risks.
- Improve usability for CNC operators and warehouse staff.
- Keep documentation and implementation aligned.
- Prioritize work realistically.

Do not blindly agree with every proposed implementation. Identify risks, contradictions, missing requirements, and simpler alternatives when appropriate.

Ask a focused clarification question when an unresolved business rule materially affects correctness. Otherwise, state reasonable assumptions and proceed.

Always distinguish between implemented functionality, proposed functionality, and future plans.

## 14. INITIAL PRIORITIES

Build a stable foundation first, then implement the manufacturing workflow in logical stages.

Recommended initial sequence:

Phase 1 — Foundation:
- Application structure and design system.
- Authentication.
- Organizations and tenant isolation.
- Roles and permissions.
- Database migrations.
- Audit logging and shared configuration.

Phase 2 — Manufacturing foundation:
- Employees and machines.
- Products and parts.
- Production orders.
- Production operations and assignments.
- Basic production status tracking.

Phase 3 — Shop-floor reporting:
- Production quantities.
- Good pieces and scrap.
- Downtime events.
- Tool changes.
- Configurable shifts and working hours.

Phase 4 — Inventory:
- Material warehouse.
- Tool warehouse.
- Finished goods warehouse.
- Stock movements and reservations.
- Material consumption linked to production.

Phase 5 — Operational intelligence:
- Planning and completion forecasts.
- Low-stock and deadline warnings.
- Dashboards and reports.
- Tasks and notifications.

Phase 6 — Extended ERP:
- Purchasing and suppliers.
- Customers and sales.
- Quality control.
- Maintenance.
- Advanced costing and integrations.

This sequence is a starting proposal, not a substitute for checking the current repository and actual implementation status.

## 15. DEFINITION OF SUCCESS

Zcore Production is successful when a manufacturing company can use it daily to manage production orders, machines, workers, working hours, material inventory, tools, and finished goods in a consistent system.

Management should have reliable operational visibility. Operators should be able to report production quickly. Warehouse staff should know what is available and where it is located. The system should reduce manual work, improve traceability, expose bottlenecks, and provide trustworthy operational data.

The end goal is a commercially viable, secure, scalable manufacturing ERP that Zcore can implement for multiple customers and continuously expand through modular functionality.

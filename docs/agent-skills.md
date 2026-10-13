# Agent Skills for Data Formulator

The top-level [skills](../skills/) directory contains reusable guidance for agents
helping users deploy and operate Data Formulator. These are product-facing skills,
not repository development instructions or the application's internal analyst skills.

## Available Skills

- [Deploy Data Formulator](../skills/deploy-data-formulator/SKILL.md): deployment,
  authentication, managed administration, shared connections, persistence, secrets,
  upgrades, and verification on the user's chosen infrastructure.

## Use a Skill

With a checkout of the intended Data Formulator revision available to your agent,
ask it to read the skill explicitly. For example:

> Read skills/deploy-data-formulator/SKILL.md and help me deploy Data Formulator
> for an authenticated team using our existing infrastructure. Confirm the target
> and proposed settings before making changes.

The top-level directory is a distribution location, not a universally
auto-discovered agent directory. For automatic discovery, use your agent's skill
installation or custom skill-location support. Install the complete skill folder,
not just its frontmatter, and keep the selected Data Formulator source checkout
available. Repository-relative links in the skill refer to that checkout; if the
skill is installed elsewhere, resolve those references against the checkout rather
than the installation directory.

Review proposed infrastructure and permission changes before approving them.
Provide secrets through the host's secure secret mechanism, never in agent chat.
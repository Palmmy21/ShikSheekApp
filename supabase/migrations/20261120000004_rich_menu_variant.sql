-- Which plan-variant rich menu (free / trial / plus / pro) is linked to each user, so the bot only
-- calls LINE when the plan actually changes.
alter table users add column rich_menu_variant text check (rich_menu_variant in ('free', 'trial', 'plus', 'pro'));

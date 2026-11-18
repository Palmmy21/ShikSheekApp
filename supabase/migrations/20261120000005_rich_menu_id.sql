-- Remember the exact rich menu id linked to each user (menus get new ids when re-uploaded).
alter table users add column rich_menu_id text;

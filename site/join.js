// Guest join page for heypullup.com/join/<token>.
//
// Guests join with a Supabase anonymous sign-in and a name, then use the same
// RPCs and RLS rules as the app: join_plan to join, cast_vote to vote (it also
// auto-locks the spot), and a plain update for their RSVP. The session lives in
// localStorage, so coming back to the link shows the plan again.
//
// A guest never has to vote. If the host has a pick, the page leads with it
// ("unless the crew wants something else") and one tap agrees; the plan decides
// itself at vote_status().decide_at either way.
(function () {
  'use strict';

  var APP_STORE = 'https://apps.apple.com/app/id6790259365';
  var boot = window.__JOIN__ || {};
  var token = boot.token || (location.pathname.match(/^\/join\/([A-Za-z0-9_-]{8,64})\/?$/) || [])[1] || '';
  var joinedKey = 'pullup-joined:' + token;

  var sb = null;
  if (boot.supabaseUrl && boot.supabaseAnonKey && window.supabase) {
    sb = window.supabase.createClient(boot.supabaseUrl, boot.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pullup-web-auth' },
    });
  }

  var state = { preview: boot.preview || null, planId: null, uid: null, myName: '', plan: null, status: null, tieNotified: false, showOthers: false, searched: false };

  // ── helpers ────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  function show(id) {
    ['view-invite', 'view-name', 'view-plan', 'view-gone', 'view-error'].forEach(function (v) {
      $(v).hidden = v !== id;
    });
    window.scrollTo(0, 0);
  }

  function fail(msg) {
    if (msg) $('error-msg').textContent = msg;
    show('view-error');
  }

  // Build DOM with textContent only, so plan and venue names can't inject HTML.
  function el(tag, props, children) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'text') n.textContent = props[k];
      else if (k === 'class') n.className = props[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), props[k]);
      else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function storage(fn) { try { return fn(window.localStorage); } catch (e) { return null; } }

  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var now = new Date();
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((day - today) / 86400000);
    var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var label = diff === 0 ? (d.getHours() >= 17 ? 'Tonight' : 'Today')
      : diff === 1 ? 'Tomorrow'
      : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return label + ' · ' + time;
  }

  function mapsUrl(name, lat, lng) {
    var q = lat != null && lng != null ? lat + ',' + lng : name;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  function logEvent(name, props) {
    if (!sb || !state.uid) return;
    sb.from('analytics_events').insert({
      user_id: state.uid, plan_id: state.planId, event_name: name, properties_json: props || null,
    }).then(function () {}, function () {});
  }

  function notify(event, extra) {
    if (!sb) return;
    sb.functions.invoke('notify', {
      body: {
        event: event, plan_id: state.planId, actor_user_id: state.uid,
        extra: Object.assign({ actor_name: state.myName || 'Someone', plan_title: (state.plan && state.plan.title) || 'a plan' }, extra || {}),
      },
    }).then(function () {}, function () {});
  }

  // ── invite ─────────────────────────────────────────────────

  function renderInvite(p) {
    $('inv-host').textContent = p.host_name ? p.host_name + ' invited you to' : "You're invited to";
    $('inv-title').textContent = p.plan_title;
    var facts = $('inv-facts');
    facts.textContent = '';
    var t = when(p.arrival_time || p.scheduled_for);
    if (t) facts.appendChild(el('li', { text: '🕒 ' + t }));
    facts.appendChild(el('li', { text: '📍 ' + (p.place_name
      || (p.pick_name ? (p.host_name ? p.host_name + '’s pick: ' : 'Leading: ') + p.pick_name : null)
      || (p.voting_enabled ? 'Spot to be voted on' : 'Host is picking the spot')) }));
    if (p.going_count > 0) facts.appendChild(el('li', { text: '🙌 ' + p.going_count + ' going' }));
    if (p.state === 'cancelled' || p.state === 'completed') {
      $('btn-guest').hidden = true;
      facts.appendChild(el('li', { text: p.state === 'cancelled' ? 'This plan was cancelled.' : 'This plan has ended.' }));
    }
    show('view-invite');
  }

  async function startJoin() {
    if (!sb) return fail("Joining on the web isn't available right now. Get the app to join.");
    var session = (await sb.auth.getSession()).data.session;
    if (session) {
      // Already a guest from another invite: reuse the same name.
      var me = await sb.from('users').select('display_name').eq('id', session.user.id).maybeSingle();
      return join(me.data && me.data.display_name);
    }
    show('view-name');
    $('name-input').focus();
  }

  async function join(name) {
    var btn = $('btn-join');
    btn.disabled = true;
    $('name-error').hidden = true;
    try {
      var session = (await sb.auth.getSession()).data.session;
      if (!session) {
        var signIn = await sb.auth.signInAnonymously({ options: { data: { display_name: name } } });
        if (signIn.error) throw signIn.error;
        session = signIn.data.session;
      }
      state.uid = session.user.id;
      state.myName = name || 'Guest';

      var res = await sb.rpc('join_plan', { p_token: token }).single();
      if (res.error) {
        if (/invalid_or_expired/.test(res.error.message)) return show('view-gone');
        throw res.error;
      }
      state.planId = res.data.plan_id;
      storage(function (s) { s.setItem(joinedKey, state.planId); });
      await loadPlan();
      if (res.data.joined) {
        logEvent('plan_joined', { source: 'web', invite_id: res.data.invite_id, inviter_user_id: res.data.inviter_user_id });
        notify('member_joined');
      }
    } catch (e) {
      console.error(e);
      if ($('view-name').hidden) return fail();
      $('name-error').textContent = "Couldn't join. Check your connection and try again.";
      $('name-error').hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  // ── plan ───────────────────────────────────────────────────

  async function loadPlan() {
    var id = state.planId;
    var results = await Promise.all([
      sb.from('plans').select('id, title, state, scheduled_for, arrival_time, voting_enabled, anchor_lat, selected_place_id, selected_place_name, selected_place_lat, selected_place_lng').eq('id', id).single(),
      sb.from('plan_members').select('user_id, role, rsvp_status, departure_status, users(display_name)').eq('plan_id', id),
      sb.from('venue_candidates').select('id, place_id, name, category, rating, price_level, photo_urls, address, maps_url, lat, lng').eq('plan_id', id),
      sb.from('venue_swipes').select('user_id, venue_candidate_id, direction').eq('plan_id', id),
      sb.rpc('vote_status', { p_plan_id: id }).maybeSingle(),
    ]);
    if (results[0].error) throw results[0].error;
    state.plan = results[0].data;
    state.members = results[1].data || [];
    state.candidates = results[2].data || [];
    state.swipes = results[3].data || [];
    state.status = results[4].data || null;

    // Nobody has opened the deck in the app yet, so there's nothing to vote on.
    // If the plan has an area, fetch the spots ourselves (once).
    var p = state.plan;
    if (p.state === 'open' && p.voting_enabled && !state.candidates.length && p.anchor_lat != null && !state.searched) {
      state.searched = true;
      var found = await sb.functions.invoke('search-venues', { body: { plan_id: id } });
      if (!found.error) return loadPlan();
    }
    var me = state.members.find(function (m) { return m.user_id === state.uid; });
    if (!me) {
      // Removed from the plan, or the session belongs to someone else.
      storage(function (s) { s.removeItem(joinedKey); });
      return renderInvite(state.preview || { plan_title: state.plan.title, voting_enabled: state.plan.voting_enabled });
    }
    state.me = me;
    state.myName = (me.users && me.users.display_name) || state.myName;
    renderPlan();
  }

  function renderPlan() {
    var p = state.plan;
    $('plan-when').textContent = when(p.arrival_time || p.scheduled_for);
    $('plan-title').textContent = p.title;
    var host = state.members.find(function (m) { return m.role === 'host'; });
    var going = state.members.filter(function (m) { return m.rsvp_status === 'going'; }).length;
    $('plan-sub').textContent = [host && host.users ? 'Hosted by ' + host.users.display_name : null, going + ' going']
      .filter(Boolean).join(' · ');

    Array.prototype.forEach.call($('rsvp').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-rsvp') === state.me.rsvp_status);
    });

    renderSpot();
    renderPeople();
    show('view-plan');
  }

  function renderSpot() {
    var p = state.plan;
    var box = $('spot');
    box.textContent = '';

    if (p.state === 'cancelled' || p.state === 'completed') {
      box.appendChild(el('h2', { text: p.state === 'cancelled' ? 'This plan was cancelled' : 'This plan has ended' }));
      return;
    }

    if (p.selected_place_name) {
      var v = state.candidates.find(function (c) { return c.place_id === p.selected_place_id; }) || {};
      box.appendChild(el('h2', { text: 'The spot' }));
      box.appendChild(venueCard(v.name ? v : { name: p.selected_place_name }, null));
      box.appendChild(el('a', {
        class: 'btn btn-primary', target: '_blank', rel: 'noopener',
        href: v.maps_url || mapsUrl(p.selected_place_name, p.selected_place_lat, p.selected_place_lng),
        text: 'Open in Maps',
      }));
      return;
    }

    if (!p.voting_enabled) {
      box.appendChild(el('h2', { text: 'The spot' }));
      box.appendChild(el('p', { class: 'muted', text: "The host is picking the spot. Check back here, or get the app to hear when it's set." }));
      return;
    }

    var likes = {};
    var mine = {};
    state.swipes.forEach(function (s) {
      if (s.direction === 'right') likes[s.venue_candidate_id] = (likes[s.venue_candidate_id] || 0) + 1;
      if (s.user_id === state.uid) mine[s.venue_candidate_id] = s.direction;
    });
    var st = state.status || {};
    var decides = st.decide_at ? when(st.decide_at) : '';
    var pick = st.host_pick_candidate_id
      ? state.candidates.find(function (c) { return c.id === st.host_pick_candidate_id; })
      : null;

    if (!state.candidates.length) {
      box.appendChild(el('h2', { text: 'The spot' }));
      box.appendChild(el('p', { class: 'muted', text: 'No spots to pick from yet. ' + hostName() + ' is still adding options, so check back here.' }));
      return;
    }

    function byLikes(a, b) { return (likes[b.id] || 0) - (likes[a.id] || 0); }
    function list(items) {
      var wrap = el('div', { class: 'venues' });
      items.slice().sort(byLikes).forEach(function (c) {
        wrap.appendChild(venueCard(c, { likes: likes[c.id] || 0, mine: mine[c.id] }));
      });
      return wrap;
    }

    if (!pick) {
      box.appendChild(el('h2', { text: 'Pick the spot' }));
      box.appendChild(el('p', { class: 'muted', text: 'Like the places you’d go. Most likes wins' + (decides ? ', and it settles ' + decides + '.' : '.') }));
      box.appendChild(list(state.candidates));
      return;
    }

    // The host's pick is the default: one tap to agree, nothing needed at all.
    var agreed = mine[pick.id] === 'right';
    var others = state.candidates.filter(function (c) { return c.id !== pick.id; });
    var likedOther = others.some(function (c) { return mine[c.id] === 'right'; });
    box.appendChild(el('h2', { text: hostName() + '’s pick' }));
    box.appendChild(venueCard(pick, null));
    box.appendChild(el('p', { class: 'muted pick-note', text:
      'Going here unless the crew wants something else.' + (decides ? ' Settles ' + decides + '.' : '') }));
    box.appendChild(agreed
      ? el('p', { class: 'pick-agreed', text: '✓ Works for you' + ((likes[pick.id] || 0) > 1 ? ' and ' + ((likes[pick.id] || 0) - 1) + ' more' : '') })
      : el('button', { type: 'button', class: 'btn btn-primary', text: 'Works for me', onclick: function () { castVote(pick, 'right'); } }));

    if (!others.length) return;
    if (state.showOthers || likedOther) {
      box.appendChild(el('h3', { text: 'Something else?' }));
      box.appendChild(el('p', { class: 'muted', text: 'Like any you’d rather go to. If more of the crew agrees, it wins.' }));
      box.appendChild(list(others));
    } else {
      box.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', text: 'I’d rather go somewhere else',
        onclick: function () { state.showOthers = true; renderSpot(); } }));
    }
  }

  function hostName() {
    var host = (state.members || []).find(function (m) { return m.role === 'host'; });
    return (host && host.users && host.users.display_name) || 'The host';
  }

  function venueCard(v, vote) {
    var photo = v.photo_urls && v.photo_urls[0];
    var meta = [
      v.category,
      v.rating ? '★ ' + Number(v.rating).toFixed(1) : null,
      v.price_level ? '$'.repeat(v.price_level) : null,
    ].filter(Boolean).join(' · ');
    var card = el('div', { class: 'venue' }, [
      photo ? el('img', { src: photo, alt: '', loading: 'lazy' }) : el('div', { class: 'venue-ph', text: '📍' }),
      el('div', { class: 'venue-body' }, [
        el('strong', { text: v.name }),
        meta ? el('span', { text: meta }) : null,
        v.address ? el('span', { text: v.address }) : null,
        vote && vote.likes ? el('span', { class: 'likes', text: vote.likes + (vote.likes === 1 ? ' like' : ' likes') }) : null,
      ]),
    ]);
    if (vote) {
      card.appendChild(el('div', { class: 'vote' }, [
        el('button', { type: 'button', class: vote.mine === 'left' ? 'on' : '', 'aria-label': 'Pass on ' + v.name, text: '✕', onclick: function () { castVote(v, 'left'); } }),
        el('button', { type: 'button', class: vote.mine === 'right' ? 'on like' : 'like', 'aria-label': 'Like ' + v.name, text: '♥', onclick: function () { castVote(v, 'right'); } }),
      ]));
    }
    return card;
  }

  function renderPeople() {
    var labels = { going: 'Going', maybe: 'Maybe', not_going: "Can't make it", pending: 'Invited' };
    var ul = $('people');
    ul.textContent = '';
    state.members
      .slice()
      .sort(function (a, b) { return (a.role === 'host' ? -1 : 0) - (b.role === 'host' ? -1 : 0); })
      .forEach(function (m) {
        var name = (m.users && m.users.display_name) || 'Someone';
        ul.appendChild(el('li', {}, [
          el('span', { class: 'avatar', text: name.charAt(0).toUpperCase() }),
          el('span', { class: 'who', text: name + (m.user_id === state.uid ? ' (you)' : '') + (m.role === 'host' ? ' · host' : '') }),
          el('span', { class: 'status', text: labels[m.rsvp_status] || '' }),
        ]));
      });
  }

  async function castVote(v, direction) {
    var res = await sb.rpc('cast_vote', { p_candidate_id: v.id, p_direction: direction }).single();
    if (res.error) {
      if (!/voting_closed/.test(res.error.message)) console.error(res.error);
    } else if (res.data.locked) {
      logEvent('venue_locked', { source: 'auto' });
      notify('venue_locked', { place_name: res.data.place_name });
    } else if (res.data.tie && !state.tieNotified) {
      state.tieNotified = true;
      notify('venue_tie');
    }
    loadPlan().catch(console.error);
  }

  async function setRsvp(status) {
    if (!state.me || state.me.rsvp_status === status) return;
    var prev = state.me.rsvp_status;
    state.me.rsvp_status = status;
    renderPlan();
    var res = await sb.from('plan_members').update({ rsvp_status: status })
      .eq('plan_id', state.planId).eq('user_id', state.uid);
    if (res.error) { state.me.rsvp_status = prev; renderPlan(); }
  }

  // ── wiring ─────────────────────────────────────────────────

  ['btn-open-app', 'btn-open-app-2', 'btn-open-app-3'].forEach(function (id) {
    $(id).href = token ? 'pullup://join/' + token : APP_STORE;
  });
  $('btn-guest').addEventListener('click', function () { startJoin().catch(function (e) { console.error(e); fail(); }); });
  $('name-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('name-input').value.trim();
    if (name) join(name);
  });
  $('rsvp').addEventListener('click', function (e) {
    var s = e.target.getAttribute && e.target.getAttribute('data-rsvp');
    if (s) setRsvp(s);
  });
  // Pick up votes and the locked spot when the guest comes back to the tab.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.planId && !$('view-plan').hidden) loadPlan().catch(console.error);
  });

  async function init() {
    if (!token) return show('view-gone');
    if (sb) {
      var session = (await sb.auth.getSession()).data.session;
      var planId = storage(function (s) { return s.getItem(joinedKey); });
      if (session && planId) {
        state.uid = session.user.id;
        state.planId = planId;
        try { return await loadPlan(); } catch (e) { console.error(e); }
      }
      if (!state.preview && boot.failed !== false) {
        var r = await sb.rpc('invite_preview', { p_token: token });
        if (!r.error) state.preview = (r.data || [])[0] || null;
        else return fail();
      }
    }
    if (!state.preview) return sb ? show('view-gone') : fail('Open this invite in the Pull Up app.');
    renderInvite(state.preview);
  }

  init().catch(function (e) { console.error(e); fail(); });
})();

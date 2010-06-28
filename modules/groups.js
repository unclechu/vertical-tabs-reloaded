/*
 * Functionality for grouping tabs.
 *
 * Groups are implemented as a special kind of tab (see binding in
 * group.xml).  There are a few advantages and disadvantages to this:
 *
 *   - Groups can be regular children of tabbrowser.tabContainer
 *     (cf. https://bugzilla.mozilla.org/show_bug.cgi?id=475142).
 *
 *   - The nsISessionStore service takes care of restoring groups and
 *     their properties.
 *
 *   - But we have to make sure that groups don't behave like tabs at
 *     all.
 */

var EXPORTED_SYMBOLS = ["VTGroups"];
Components.utils.import("resource://verticaltabs/tabdatastore.js");

function VTGroups(tabs) {
    this.tabs = tabs;
    tabs.VTGroups = this;

    // Restore group and in-group status
    tabs.addEventListener('SSTabRestoring', this, true);

    // Updating UI
    tabs.addEventListener('TabSelect', this, false);

    // For clicks on the twisty
    tabs.addEventListener('click', this, true);

    // For synchronizing group behaviour and tab positioning
    tabs.addEventListener('dragover', this, false);
    tabs.addEventListener('dragend', this, false);
    tabs.addEventListener('drop', this, false);
    tabs.addEventListener('TabMove', this, false);
}
VTGroups.prototype = {

    kId: 'verticaltabs-id',
    kGroup: 'verticaltabs-group',
    kInGroup: 'verticaltabs-ingroup',
    kLabel: 'verticaltabs-grouplabel',
    kCollapsed: 'verticaltabs-collapsed',
    kDropTarget: 'verticaltabs-droptarget',

    restoreTab: function(aTab) {
        // Restore tab attributes from session data (this isn't done
        // automatically).  kId is restored by VTTabIDs.
        for each (let attr in [this.kGroup,
                               this.kInGroup,
                               this.kLabel,
                               this.kCollapsed]) {
            let value = VTTabDataStore.getTabValue(aTab, attr);
            if (value) {
                aTab.setAttribute(attr, value);
            }
        }

        // Restore collapsed state if we belong to a group.
        let groupId = VTTabDataStore.getTabValue(aTab, this.kInGroup);
        if (!groupId) {
            return;
        }

        var self = this;
        var window = this.tabs.ownerDocument.defaultView;
        function restoreCollapsedState() {
            // The group tab we belong to may not have been restored yet.
            var group = self.tabs.VTTabIDs.get(groupId);
            if (group === undefined) {
                window.setTimeout(restoreCollapsedState, 10);
                return;
            }
            let collapsed = (VTTabDataStore.getTabValue(group, self.kCollapsed)
                             == "true");
            self._tabCollapseExpand(aTab, collapsed);
        }
        restoreCollapsedState();
    },

    _tabCollapseExpand: function(aTab, collapsed) {
        if (collapsed) {
            aTab.classList.add(this.kCollapsed);
        } else {
            aTab.classList.remove(this.kCollapsed);
        }
    },


    /*** Public API ***/

    addGroup: function(aLabel) {        
        var group = this.tabs.tabbrowser.addTab();
        VTTabDataStore.setTabValue(group, this.kGroup, 'true');

        var window = this.tabs.ownerDocument.defaultView;
        function makeLabelEditable() {
            // XBL bindings aren't applied synchronously.
            if (typeof group.editLabel !== "function") {
                window.setTimeout(makeLabelEditable, 10);
                return;
            }
            group.editLabel();
        }

        if (aLabel) {
            VTTabDataStore.setTabValue(group, this.kLabel, aLabel);
            group.groupLabel = aLabel;
        } else {
            makeLabelEditable();
        }

        return group;
    },

    getChildren: function(aGroup) {
        var groupId = this.tabs.VTTabIDs.id(aGroup);
        return this.tabs.getElementsByAttribute(this.kInGroup, groupId);
    },

    addChild: function(aGroup, aTab) {
        // Only groups can have children
        if (!this.isGroup(aGroup)) {
            return;
        }
        // We don't allow nested groups
        if (this.isGroup(aTab)) {
            return;
        }

        // Assign a group to the tab.  If the tab was in another group
        // before, this will simply overwrite the old value.
        let groupId = this.tabs.VTTabIDs.id(aGroup);
        VTTabDataStore.setTabValue(aTab, this.kInGroup, groupId);

        // Apply the group's collapsed state to the tab
        let collapsed = (VTTabDataStore.getTabValue(aGroup, this.kCollapsed)
                         == "true");
        aTab.collapsed = collapsed;
    },

    removeChild: function(aTab) {
        var groupId = VTTabDataStore.getTabValue(aTab, this.kInGroup);
        if (!groupId) {
            return;
        }

        VTTabDataStore.deleteTabValue(aTab, this.kInGroup);
    },

    createGroupFromMultiSelect: function() {
        var group = this.addGroup();
        var children = this.tabs.VTMultiSelect.getSelected();
        for each (let tab in children) {
            // Moving the tabs to the right position is enough, the
            // TabMove handler knows the right thing to do.
            this.tabs.tabbrowser.moveTabTo(tab, group._tPos+1);
        }
        this.tabs.VTMultiSelect.clear();
    },

    isGroup: function(aTab) {
        return (VTTabDataStore.getTabValue(aTab, this.kGroup) == "true");
    },

    collapseExpand: function(aGroup) {
        if (!this.isGroup(aGroup)) {
            return;
        }
        let collapsed = (VTTabDataStore.getTabValue(aGroup, this.kCollapsed)
                         == "true");
        let children = this.getChildren(aGroup);
        for (let i=0; i < children.length; i++) {
            this._tabCollapseExpand(children[i], !collapsed);
        }
        VTTabDataStore.setTabValue(aGroup, this.kCollapsed, !collapsed);
    },


    /*** Event handlers ***/

    handleEvent: function(aEvent) {
        switch (aEvent.type) {
        case 'SSTabRestoring':
            this.restoreTab(aEvent.originalTarget);
            return;
        case 'TabSelect':
            this.onTabSelect(aEvent);
            return;
        case "click":
            this.onClick(aEvent);
            return;
        case "dragover":
            this.onDragOver(aEvent);
            return;
        case "dragend":
        case "drop":
            this.clearDropTargets();
            return;
        case 'TabMove':
            this.onTabMove(aEvent);
            return;
        }
    },

    onTabSelect: function(aEvent) {
        var tab = aEvent.target;
        var document = tab.ownerDocument;
        var urlbar = document.getElementById("urlbar");

        var isGroup = this.isGroup(tab);
        if (isGroup) {
            urlbar.placeholder = "Group";
        } else {
            urlbar.placeholder = urlbar.getAttribute("bookmarkhistoryplaceholder");
        }
        urlbar.disabled = isGroup;

        //XXX this doesn't quite work:
        var buttons = ["reload-button", "home-button", "urlbar", "searchbar"];
        for (let i=0; i < buttons.length; i++) {
            let element = document.getElementById(buttons[i]);
            element.disabled = isGroup;
        }
    },

    onClick: function(aEvent) {
        var tab = aEvent.target;
        if (tab.localName != "tab") {
            return;
        }
        if (aEvent.originalTarget !== tab.mTwisty) {
            return;
        }
        this.collapseExpand(tab);
    },

    clearDropTargets: function() {
        var groups = this.tabs.getElementsByClassName(this.kDropTarget);
        // Make a copy of the array before modifying its contents.
        groups = Array.prototype.slice.call(groups);
        for (let i=0; i < groups.length; i++) {
            groups[i].classList.remove(this.kDropTarget);
        }
    },

    onDragOver: function(aEvent) {
        if (aEvent.target.localName != "tab") {
            return;
        }
        // Potentially remove drop target style
        //XXX is this inefficient?
        this.clearDropTargets();

        if (this.isGroup(aEvent.target)) {
          aEvent.target.classList.add(this.kDropTarget);
          this.tabs._tabDropIndicator.collapsed = true;
          return;
        }

        let dropindex = this.tabs._getDropIndex(aEvent);
        let tab = this.tabs.childNodes[dropindex];
        let groupId = VTTabDataStore.getTabValue(tab, this.kInGroup);
        if (!groupId) {
            return;
        }
        //TODO change drop indicator's left margin
        // Add drop style to the group
        let group = this.tabs.VTTabIDs.get(groupId);
        group.classList.add(this.kDropTarget);
    },

    onTabMove: function(aEvent) {
        var tab = aEvent.target;
        if (this.isGroup(tab)) {
            return;
        }

        // Determine whether the move should result in the tab being
        // added to a group (or removed from one).
        let group;
        let nextPos = tab._tPos + 1;
        if (nextPos < this.tabs.childNodes.length) {
            // If the next tab down the line is in a group, then the
            // tab is added to that group.
            let next = this.tabs.childNodes[nextPos];
            let groupId = VTTabDataStore.getTabValue(next, this.kInGroup);
            group = this.tabs.VTTabIDs.get(groupId);
        } else {
            // We're moved to the last position, so let's look at the
            // previous tab.  Is it in a group, or even a group?
            nextPos = tab._tPos - 1;
            let prev = this.tabs.childNodes[nextPos];
            if (this.isGroup(prev)) {
                group = prev;
            } else {
                let groupId = VTTabDataStore.getTabValue(prev, this.kInGroup);
                group = this.tabs.VTTabIDs.get(groupId);
            }
        }

        if (!group) {
            this.removeChild(tab);
        } else {
            this.addChild(group, tab);
        }
    }

};
package views
package html.site

import scala.util.chaining._

import controllers.routes

import lila.api.Context
import lila.app.templating.Environment._
import lila.app.ui.ScalatagsTemplate._

object contact {

  import trans.contact._

  sealed private trait Node {
    val id: String
    val name: Frag
  }
  private case class Branch(id: String, name: Frag, children: List[Node]) extends Node
  private case class Leaf(id: String, name: Frag, content: Frag)          extends Node

  private def reopenLeaf(prefix: String)(implicit ctx: Context) =
    Leaf(
      s"$prefix-reopen",
      wantReopen(),
      frag(
        p("Automatic account reopening is unavailable. Contact a site moderator."),
      ),
    )

  private def howToReportBugs(implicit ctx: Context): Frag =
    frag(
      ul(
        li(
          a(href := routes.ForumCateg.show("lishogi-feedback"))(reportBugInForum()),
        ),
        li(
          a(href := "https://github.com/WandererXII/lila/issues")(reportWebsiteIssue()),
        ),
      ),
      p(howToReportBug()),
    )

  private def menu(implicit ctx: Context): Branch =
    Branch(
      "root",
      whatCanWeHelpYouWith(),
      List(
        Branch(
          "login",
          iCantLogIn(),
          List(
            Leaf(
              "forgot-password",
              forgotPassword(),
              p(
                "Email-based password recovery is unavailable on this site.",
              ),
            ),
            Leaf(
              "forgot-username",
              forgotUsername(),
              p(
                "Sign in with the username you chose at registration.",
              ),
            ),
            Leaf(
              "lost-2fa",
              lost2FA(),
              p("Use your authenticator to sign in. Email-based two-factor recovery is unavailable."),
            ),
            reopenLeaf("login"),
            Leaf(
              "dns",
              "\"This site can’t be reached\"",
              frag(
                p("If you can't reach Lishogi, and your browser says something like:"),
                ul(
                  li("This site can't be reached."),
                  li(strong("lishogi.org"), "’s server IP address could not be found."),
                  li("We can’t connect to the server at lishogi.org."),
                ),
                p("Then you have a ", strong("DNS issue"), "."),
                p(
                  "There's nothing we can do about it, but ",
                  a("here's how you can fix it")(
                    href := "https://www.wikihow.com/Fix-DNS-Server-Not-Responding-Problem",
                  ),
                  ".",
                ),
              ),
            ),
          ),
        ),
        Branch(
          "account",
          accountSupport(),
          List(
            Leaf(
              "title",
              wantTitle(),
              p(
                (visitTitleConfirmation()), // master
                ".",
              ),
            ),
            Leaf(
              "close",
              wantCloseAccount(),
              frag(
                p(a(href := routes.Account.close)(closeYourAccount()), "."),
                p(doNotAskByEmail()),
              ),
            ),
            reopenLeaf("account"),
            Leaf(
              "change-username",
              wantChangeUsername(),
              frag(
                p(a(href := routes.Account.username)(changeUsernameCase()), "."),
                p(cantChangeMore()),
                p(orCloseAccount()),
              ),
            ),
            Leaf(
              "clear-history",
              wantClearHistory(),
              frag(
                p(cantClearHistory()),
                p(orCloseAccount()),
              ),
            ),
          ),
        ),
        Branch(
          "report",
          wantReport(),
          List(
            "cheating"          -> cheating(),
            "sandbagging"       -> sandbagging(),
            "trolling"          -> trolling(),
            "insults"           -> insults(),
            "some other reason" -> otherReason(),
          ).map { case (reason, name) =>
            Leaf(
              reason,
              frag("Report a player for ", name),
              frag(
                p(
                  a(href := routes.Report.form)(toReportAPlayer(name)),
                  ".",
                ),
                p(
                  youCanAlsoReachReportPage(
                    button(cls := "thin button button-empty", dataIcon := Icons.warning),
                  ),
                ),
                p(
                  doNotMessageModerators(),
                  br,
                  doNotReportInForum(),
                  br,
                  doNotSendReportEmails(),
                  br,
                  onlyReports(),
                ),
              ),
            )
          },
        ),
        Branch(
          "bug",
          wantReportBug(),
          List(
            Leaf(
              "casual",
              noRatingPoints(),
              p(ratedGame()),
            ),
            Leaf(
              "error-page",
              errorPage(),
              frag(
                p(reportErrorPage()),
                howToReportBugs,
              ),
            ),
            Leaf(
              "security",
              "Security vulnerability",
              frag(
                p(s"Please report security issues to $contactEmail."),
                p(
                  "Like all contributions to Lishogi, security reviews and pentesting are appreciated. ",
                  "Note that Lishogi is built by volunteers and we currently do not have a bug bounty program.",
                ),
                p(
                  "Vulnerabilities are relevant even when they are not directly exploitable, ",
                  "for example XSS mitigated by CSP.",
                ),
                p(
                  "When doing your research, please minimize negative impact for other users. ",
                  "As long as you keep this in mind, testing should not require prior coordination. ",
                  "Avoid spamming, DDoS and volumetric attacks.",
                ),
                p(
                  "We believe transport encryption should be sufficient for all reports. ",
                  "If you insist on using PGP, please clarify the nature of the message ",
                  "in the plain-text subject and encrypt for ",
                  a(href := "/.well-known/gpg.asc")("multiple recipients"),
                  ".",
                ),
              ),
            ),
            Leaf(
              "other-bug",
              "Other bug",
              frag(
                p("If you found a new bug, you may report it:"),
                howToReportBugs,
              ),
            ),
          ),
        ),
        frag(
          p(doNotMessageModerators()),
          p(sendAppealTo(a(href := routes.Appeal.home)("lishogi.org", routes.Appeal.home.url))),
          p(
            falsePositives(),
            br,
            ifLegit(),
          ),
        ) pipe { appealBase =>
          Branch(
            "appeal",
            banAppeal(),
            List(
              Leaf(
                "appeal-cheat",
                engineAppeal(),
                frag(
                  appealBase,
                  p(
                    accountLost(),
                    br,
                    doNotDeny(),
                  ),
                ),
              ),
              Leaf(
                "appeal-other",
                otherRestriction(),
                appealBase,
              ),
            ),
          )
        },
        Branch(
          "collab",
          collaboration(),
          List(
            Leaf(
              "authorize",
              authorizationToUse(),
              frag(
                p(welcomeToUse()),
                p(videosAndBooks()),
                p(creditAppreciated()),
              ),
            ),
            Leaf(
              "gdpr",
              "GDPR",
              frag(
                p(
                  "If you are a European citizen, you may request the deletion of your Lishogi account.",
                ),
                p(
                  "First, ",
                  a(href := routes.Account.close)("close your account"),
                  ".",
                ),
                p(
                  "Contact a site moderator to request the erasure of personal account data.",
                ),
                p(
                  "Note that games are facts, not personal information. And as such they are never deleted.",
                ),
              ),
            ),
            Leaf(
              "contact-other",
              noneOfTheAbove(),
              frag(
                p("Contact a site moderator through the discussion forum."),
                p(explainYourRequest()),
              ),
            ),
          ),
        ),
      ),
    )

  private def renderNode(node: Node, parent: Option[Node])(implicit ctx: Context): Frag =
    node match {
      case Leaf(_, _, content) =>
        List(
          div(makeId(node.id), cls := "node leaf")(
            h2(parent map goBack, node.name),
            div(cls := "content")(content),
          ),
        )
      case b @ Branch(id, _, children) =>
        frag(
          div(makeId(node.id), cls := s"node branch $id")(
            h2(parent map goBack, node.name),
            div(cls := "links")(
              children map { child =>
                a(makeLink(child.id))(child.name)
              },
            ),
          ),
          children map { renderNode(_, b.some) },
        )
    }

  private def renderedMenu(implicit ctx: Context) = renderNode(menu, none)

  private def makeId(id: String)   = st.id := s"help-$id"
  private def makeLink(id: String) = href  := s"#help-$id"

  private def goBack(parent: Node): Frag =
    a(makeLink(parent.id), cls := "back", dataIcon := Icons.left, title := "Go back")

  def apply()(implicit ctx: Context) =
    help.layout(
      title = trans.contact.contact.txt(),
      active = "contact",
      moreCss = cssTag("misc.contact"),
      moreJs = embedJsUnsafe("""location=location.hash||"#help-root""""),
      contentCls = "page box box-pad",
    )(
      frag(
        h1(contactLishogi()),
        div(cls := "contact")(
          renderedMenu,
        ),
      ),
    )
}

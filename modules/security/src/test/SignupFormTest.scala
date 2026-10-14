package lila.security

import org.specs2.mutable.Specification
import play.api.data.Forms._

class SignupFormTest extends Specification {

  private val username = nonEmptyText(minLength = 2, maxLength = 20)
  private val website = DataForm.websiteSignupForm(username)
  private val mobile = DataForm.mobileSignupForm(username)
  private val credentials = Map("username" -> "NoMailUser", "password" -> "correct-password")
  private val agreements = List("assistance", "nice", "account", "policy")
    .map(name => s"agreement.$name" -> "true").toMap

  "email-free signup forms" should {
    "accept web registration without an email" in {
      val bound = website.bind(credentials ++ agreements)
      bound.hasErrors must beFalse
      bound.get.username must beEqualTo("NoMailUser")
    }
    "accept mobile registration without an email" in {
      mobile.bind(credentials).hasErrors must beFalse
    }
    "retain password validation" in {
      website.bind(credentials.updated("password", "123") ++ agreements).hasErrors must beTrue
      mobile.bind(credentials - "password").hasErrors must beTrue
    }
    "retain the web policy agreements" in {
      website.bind(credentials).hasErrors must beTrue
      website.bind(credentials ++ agreements.updated("agreement.policy", "false")).hasErrors must beTrue
    }
    "ignore a legacy email parameter" in {
      val withoutEmail = website.bind(credentials ++ agreements).get
      val legacy = website.bind(credentials ++ agreements + ("email" -> "invalid email")).get
      legacy must beEqualTo(withoutEmail)
    }
  }
}
